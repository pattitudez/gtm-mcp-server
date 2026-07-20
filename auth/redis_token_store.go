package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"golang.org/x/oauth2"
)

// Key prefixes for the Redis token store. A shared prefix keeps all server
// keys grouped and avoids collisions when the Redis database is shared.
const (
	redisKeyPrefix  = "gtmmcp:"
	redisTokenKey   = redisKeyPrefix + "token:"   // access token -> TokenInfo JSON
	redisRefreshKey = redisKeyPrefix + "refresh:" // refresh token -> access token
	redisStateKey   = redisKeyPrefix + "state:"   // state/auth code -> AuthState JSON
	redisClientKey  = redisKeyPrefix + "client:"  // client_id -> ClientInfo JSON
)

const (
	// redisOpTimeout bounds each Redis round trip.
	redisOpTimeout = 5 * time.Second

	// stateTTL matches the 10-minute state expiry of MemoryTokenStore.
	stateTTL = 10 * time.Minute

	// clientTTL bounds growth of dynamically registered clients (RFC 7591).
	// Clients whose records expire simply re-register on their next connect.
	clientTTL = 180 * 24 * time.Hour

	// expiredTokenGrace mirrors MemoryTokenStore.cleanup: expired access
	// tokens remain readable (GetTokenByAccessIncludeExpired) for at least
	// this long so the middleware can run the sliding-refresh flow.
	expiredTokenGrace = 1 * time.Hour
)

// RedisTokenStore is a Redis-backed implementation of TokenStore. It allows
// OAuth sessions to survive server restarts and to be shared across multiple
// instances (serverless/container platforms that scale to zero or scale out).
//
// Writes are last-write-wins without cross-key transactions: with a single
// human user per token the write concurrency the memory store guards against
// with a mutex does not occur in practice.
type RedisTokenStore struct {
	client *redis.Client
}

// NewRedisTokenStore connects to Redis using a redis:// or rediss:// URL
// (e.g. from Upstash) and verifies the connection with a ping.
func NewRedisTokenStore(redisURL string) (*RedisTokenStore, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("invalid REDIS_URL: %w", err)
	}

	client := redis.NewClient(opts)

	ctx, cancel := context.WithTimeout(context.Background(), redisOpTimeout)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		client.Close()
		return nil, fmt.Errorf("redis ping failed: %w", err)
	}

	return &RedisTokenStore{client: client}, nil
}

// Close releases the Redis connection pool.
func (s *RedisTokenStore) Close() error {
	return s.client.Close()
}

func opCtx() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), redisOpTimeout)
}

// tokenTTL computes how long a token record should live: until the refresh
// token expires, but never less than one hour past access-token expiry so the
// sliding-refresh flow in the auth middleware keeps working.
func tokenTTL(info *TokenInfo) time.Duration {
	deadline := info.ExpiresAt.Add(expiredTokenGrace)
	if !info.RefreshExpiresAt.IsZero() && info.RefreshExpiresAt.After(deadline) {
		deadline = info.RefreshExpiresAt
	}
	ttl := time.Until(deadline)
	if ttl <= 0 {
		ttl = time.Minute
	}
	return ttl
}

func (s *RedisTokenStore) writeToken(ctx context.Context, info *TokenInfo) error {
	data, err := json.Marshal(info)
	if err != nil {
		return fmt.Errorf("marshal token: %w", err)
	}

	ttl := tokenTTL(info)
	pipe := s.client.TxPipeline()
	pipe.Set(ctx, redisTokenKey+info.AccessToken, data, ttl)
	if info.RefreshToken != "" {
		pipe.Set(ctx, redisRefreshKey+info.RefreshToken, info.AccessToken, ttl)
	}
	_, err = pipe.Exec(ctx)
	return err
}

func (s *RedisTokenStore) readToken(ctx context.Context, accessToken string) (*TokenInfo, error) {
	data, err := s.client.Get(ctx, redisTokenKey+accessToken).Bytes()
	if errors.Is(err, redis.Nil) {
		return nil, ErrTokenNotFound
	}
	if err != nil {
		return nil, err
	}

	var info TokenInfo
	if err := json.Unmarshal(data, &info); err != nil {
		return nil, fmt.Errorf("unmarshal token: %w", err)
	}
	return &info, nil
}

func (s *RedisTokenStore) StoreToken(info *TokenInfo) error {
	ctx, cancel := opCtx()
	defer cancel()
	return s.writeToken(ctx, info)
}

func (s *RedisTokenStore) GetTokenByAccess(accessToken string) (*TokenInfo, error) {
	ctx, cancel := opCtx()
	defer cancel()

	info, err := s.readToken(ctx, accessToken)
	if err != nil {
		return nil, err
	}
	if time.Now().After(info.ExpiresAt) {
		return nil, ErrTokenExpired
	}
	return info, nil
}

func (s *RedisTokenStore) GetTokenByAccessIncludeExpired(accessToken string) (*TokenInfo, error) {
	ctx, cancel := opCtx()
	defer cancel()
	return s.readToken(ctx, accessToken)
}

func (s *RedisTokenStore) GetTokenByRefresh(refreshToken string) (*TokenInfo, error) {
	ctx, cancel := opCtx()
	defer cancel()

	accessToken, err := s.client.Get(ctx, redisRefreshKey+refreshToken).Result()
	if errors.Is(err, redis.Nil) {
		return nil, ErrTokenNotFound
	}
	if err != nil {
		return nil, err
	}

	info, err := s.readToken(ctx, accessToken)
	if err != nil {
		return nil, err
	}
	if !info.RefreshExpiresAt.IsZero() && time.Now().After(info.RefreshExpiresAt) {
		return nil, ErrTokenExpired
	}
	return info, nil
}

func (s *RedisTokenStore) DeleteToken(accessToken string) error {
	ctx, cancel := opCtx()
	defer cancel()

	info, err := s.readToken(ctx, accessToken)
	if err != nil {
		if errors.Is(err, ErrTokenNotFound) {
			return nil
		}
		return err
	}

	keys := []string{redisTokenKey + accessToken}
	if info.RefreshToken != "" {
		keys = append(keys, redisRefreshKey+info.RefreshToken)
	}
	return s.client.Del(ctx, keys...).Err()
}

func (s *RedisTokenStore) UpdateGoogleToken(accessToken string, googleToken *oauth2.Token) error {
	if googleToken == nil {
		return errors.New("googleToken cannot be nil")
	}

	ctx, cancel := opCtx()
	defer cancel()

	info, err := s.readToken(ctx, accessToken)
	if err != nil {
		return err
	}
	info.GoogleToken = googleToken
	return s.writeToken(ctx, info)
}

func (s *RedisTokenStore) ExtendTokenExpiry(accessToken string, newExpiry time.Time) error {
	ctx, cancel := opCtx()
	defer cancel()

	info, err := s.readToken(ctx, accessToken)
	if err != nil {
		return err
	}
	info.ExpiresAt = newExpiry
	return s.writeToken(ctx, info)
}

func (s *RedisTokenStore) StoreState(state *AuthState) error {
	ctx, cancel := opCtx()
	defer cancel()

	data, err := json.Marshal(state)
	if err != nil {
		return fmt.Errorf("marshal state: %w", err)
	}
	return s.client.Set(ctx, redisStateKey+state.State, data, stateTTL).Err()
}

func (s *RedisTokenStore) GetState(stateValue string) (*AuthState, error) {
	ctx, cancel := opCtx()
	defer cancel()

	data, err := s.client.Get(ctx, redisStateKey+stateValue).Bytes()
	if errors.Is(err, redis.Nil) {
		return nil, ErrInvalidState
	}
	if err != nil {
		return nil, err
	}
	return unmarshalState(data)
}

// ConsumeState atomically gets and deletes a state via GETDEL, keeping auth
// codes single-use even when requests land on different server instances.
func (s *RedisTokenStore) ConsumeState(stateValue string) (*AuthState, error) {
	ctx, cancel := opCtx()
	defer cancel()

	data, err := s.client.GetDel(ctx, redisStateKey+stateValue).Bytes()
	if errors.Is(err, redis.Nil) {
		return nil, ErrInvalidState
	}
	if err != nil {
		return nil, err
	}
	return unmarshalState(data)
}

func unmarshalState(data []byte) (*AuthState, error) {
	var state AuthState
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, fmt.Errorf("unmarshal state: %w", err)
	}
	// Redundant with the key TTL, but kept for parity with MemoryTokenStore.
	if time.Since(state.CreatedAt) > stateTTL {
		return nil, ErrInvalidState
	}
	return &state, nil
}

func (s *RedisTokenStore) DeleteState(stateValue string) error {
	ctx, cancel := opCtx()
	defer cancel()
	return s.client.Del(ctx, redisStateKey+stateValue).Err()
}

func (s *RedisTokenStore) StoreClient(client *ClientInfo) error {
	ctx, cancel := opCtx()
	defer cancel()

	data, err := json.Marshal(client)
	if err != nil {
		return fmt.Errorf("marshal client: %w", err)
	}
	return s.client.Set(ctx, redisClientKey+client.ClientID, data, clientTTL).Err()
}

func (s *RedisTokenStore) GetClient(clientID string) (*ClientInfo, error) {
	ctx, cancel := opCtx()
	defer cancel()

	data, err := s.client.Get(ctx, redisClientKey+clientID).Bytes()
	if errors.Is(err, redis.Nil) {
		return nil, ErrClientNotFound
	}
	if err != nil {
		return nil, err
	}

	var client ClientInfo
	if err := json.Unmarshal(data, &client); err != nil {
		return nil, fmt.Errorf("unmarshal client: %w", err)
	}
	return &client, nil
}

func (s *RedisTokenStore) DeleteClient(clientID string) error {
	ctx, cancel := opCtx()
	defer cancel()
	return s.client.Del(ctx, redisClientKey+clientID).Err()
}
