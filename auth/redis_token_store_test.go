package auth

import (
	"errors"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"golang.org/x/oauth2"
)

func newTestRedisStore(t *testing.T) (*RedisTokenStore, *miniredis.Miniredis) {
	t.Helper()

	mr := miniredis.RunT(t)
	store, err := NewRedisTokenStore("redis://" + mr.Addr())
	if err != nil {
		t.Fatalf("NewRedisTokenStore failed: %v", err)
	}
	t.Cleanup(func() { store.Close() })
	return store, mr
}

func testTokenInfo(access, refresh string) *TokenInfo {
	return &TokenInfo{
		AccessToken:      access,
		RefreshToken:     refresh,
		ExpiresAt:        time.Now().Add(1 * time.Hour),
		RefreshExpiresAt: time.Now().Add(30 * 24 * time.Hour),
		GoogleToken: &oauth2.Token{
			AccessToken:  "google-access",
			RefreshToken: "google-refresh",
			TokenType:    "Bearer",
			Expiry:       time.Now().Add(1 * time.Hour),
		},
		ClientID:  "client-1",
		CreatedAt: time.Now(),
	}
}

func TestRedisStore_StoreAndGetToken(t *testing.T) {
	store, _ := newTestRedisStore(t)

	info := testTokenInfo("access-1", "refresh-1")
	if err := store.StoreToken(info); err != nil {
		t.Fatalf("StoreToken failed: %v", err)
	}

	got, err := store.GetTokenByAccess("access-1")
	if err != nil {
		t.Fatalf("GetTokenByAccess failed: %v", err)
	}
	if got.AccessToken != "access-1" || got.RefreshToken != "refresh-1" {
		t.Errorf("unexpected token: %+v", got)
	}
	if got.GoogleToken == nil || got.GoogleToken.AccessToken != "google-access" {
		t.Errorf("Google token not round-tripped: %+v", got.GoogleToken)
	}
	if got.ClientID != "client-1" {
		t.Errorf("ClientID = %q, want client-1", got.ClientID)
	}
}

func TestRedisStore_GetTokenNotFound(t *testing.T) {
	store, _ := newTestRedisStore(t)

	if _, err := store.GetTokenByAccess("missing"); !errors.Is(err, ErrTokenNotFound) {
		t.Errorf("expected ErrTokenNotFound, got %v", err)
	}
	if _, err := store.GetTokenByAccessIncludeExpired("missing"); !errors.Is(err, ErrTokenNotFound) {
		t.Errorf("expected ErrTokenNotFound, got %v", err)
	}
	if _, err := store.GetTokenByRefresh("missing"); !errors.Is(err, ErrTokenNotFound) {
		t.Errorf("expected ErrTokenNotFound, got %v", err)
	}
}

func TestRedisStore_ExpiredAccessToken(t *testing.T) {
	store, _ := newTestRedisStore(t)

	info := testTokenInfo("expired-access", "valid-refresh")
	info.ExpiresAt = time.Now().Add(-1 * time.Minute)
	if err := store.StoreToken(info); err != nil {
		t.Fatalf("StoreToken failed: %v", err)
	}

	// Expired for plain lookup...
	if _, err := store.GetTokenByAccess("expired-access"); !errors.Is(err, ErrTokenExpired) {
		t.Errorf("expected ErrTokenExpired, got %v", err)
	}

	// ...but still readable for the sliding-refresh flow.
	got, err := store.GetTokenByAccessIncludeExpired("expired-access")
	if err != nil {
		t.Fatalf("GetTokenByAccessIncludeExpired failed: %v", err)
	}
	if got.AccessToken != "expired-access" {
		t.Errorf("unexpected token: %+v", got)
	}

	// And refresh lookup still works while the refresh token is valid.
	if _, err := store.GetTokenByRefresh("valid-refresh"); err != nil {
		t.Errorf("GetTokenByRefresh failed: %v", err)
	}
}

func TestRedisStore_ExpiredRefreshToken(t *testing.T) {
	store, _ := newTestRedisStore(t)

	info := testTokenInfo("access-2", "expired-refresh")
	info.RefreshExpiresAt = time.Now().Add(-1 * time.Minute)
	if err := store.StoreToken(info); err != nil {
		t.Fatalf("StoreToken failed: %v", err)
	}

	if _, err := store.GetTokenByRefresh("expired-refresh"); !errors.Is(err, ErrTokenExpired) {
		t.Errorf("expected ErrTokenExpired, got %v", err)
	}
}

func TestRedisStore_DeleteToken(t *testing.T) {
	store, _ := newTestRedisStore(t)

	info := testTokenInfo("access-3", "refresh-3")
	if err := store.StoreToken(info); err != nil {
		t.Fatalf("StoreToken failed: %v", err)
	}
	if err := store.DeleteToken("access-3"); err != nil {
		t.Fatalf("DeleteToken failed: %v", err)
	}

	if _, err := store.GetTokenByAccess("access-3"); !errors.Is(err, ErrTokenNotFound) {
		t.Errorf("expected ErrTokenNotFound after delete, got %v", err)
	}
	if _, err := store.GetTokenByRefresh("refresh-3"); !errors.Is(err, ErrTokenNotFound) {
		t.Errorf("expected refresh index removed, got %v", err)
	}

	// Deleting a missing token is a no-op, matching MemoryTokenStore.
	if err := store.DeleteToken("never-existed"); err != nil {
		t.Errorf("DeleteToken on missing token: %v", err)
	}
}

func TestRedisStore_UpdateGoogleToken(t *testing.T) {
	store, _ := newTestRedisStore(t)

	info := testTokenInfo("access-4", "refresh-4")
	if err := store.StoreToken(info); err != nil {
		t.Fatalf("StoreToken failed: %v", err)
	}

	newGoogle := &oauth2.Token{AccessToken: "new-google-access", TokenType: "Bearer"}
	if err := store.UpdateGoogleToken("access-4", newGoogle); err != nil {
		t.Fatalf("UpdateGoogleToken failed: %v", err)
	}

	got, err := store.GetTokenByAccess("access-4")
	if err != nil {
		t.Fatalf("GetTokenByAccess failed: %v", err)
	}
	if got.GoogleToken.AccessToken != "new-google-access" {
		t.Errorf("Google token not updated: %+v", got.GoogleToken)
	}

	if err := store.UpdateGoogleToken("access-4", nil); err == nil {
		t.Error("expected error for nil googleToken")
	}
	if err := store.UpdateGoogleToken("missing", newGoogle); !errors.Is(err, ErrTokenNotFound) {
		t.Errorf("expected ErrTokenNotFound, got %v", err)
	}
}

func TestRedisStore_ExtendTokenExpiry(t *testing.T) {
	store, _ := newTestRedisStore(t)

	info := testTokenInfo("access-5", "refresh-5")
	info.ExpiresAt = time.Now().Add(-1 * time.Minute) // expired
	if err := store.StoreToken(info); err != nil {
		t.Fatalf("StoreToken failed: %v", err)
	}

	newExpiry := time.Now().Add(8 * time.Hour)
	if err := store.ExtendTokenExpiry("access-5", newExpiry); err != nil {
		t.Fatalf("ExtendTokenExpiry failed: %v", err)
	}

	got, err := store.GetTokenByAccess("access-5")
	if err != nil {
		t.Fatalf("token should be valid after extension: %v", err)
	}
	if !got.ExpiresAt.After(time.Now().Add(7 * time.Hour)) {
		t.Errorf("expiry not extended: %v", got.ExpiresAt)
	}
}

func TestRedisStore_TokenTTLExpiry(t *testing.T) {
	store, mr := newTestRedisStore(t)

	info := testTokenInfo("access-ttl", "refresh-ttl")
	if err := store.StoreToken(info); err != nil {
		t.Fatalf("StoreToken failed: %v", err)
	}

	// Past refresh expiry (the record deadline), the keys should be gone.
	mr.FastForward(31 * 24 * time.Hour)

	if _, err := store.GetTokenByAccessIncludeExpired("access-ttl"); !errors.Is(err, ErrTokenNotFound) {
		t.Errorf("expected token evicted by TTL, got %v", err)
	}
	if _, err := store.GetTokenByRefresh("refresh-ttl"); !errors.Is(err, ErrTokenNotFound) {
		t.Errorf("expected refresh index evicted by TTL, got %v", err)
	}
}

func TestRedisStore_StateLifecycle(t *testing.T) {
	store, _ := newTestRedisStore(t)

	state := &AuthState{
		State:        "state-1",
		CodeVerifier: "verifier",
		RedirectURI:  "https://claude.ai/api/mcp/auth_callback",
		ClientID:     "client-1",
		CreatedAt:    time.Now(),
	}
	if err := store.StoreState(state); err != nil {
		t.Fatalf("StoreState failed: %v", err)
	}

	got, err := store.GetState("state-1")
	if err != nil {
		t.Fatalf("GetState failed: %v", err)
	}
	if got.CodeVerifier != "verifier" {
		t.Errorf("unexpected state: %+v", got)
	}

	// Consume returns the state once...
	consumed, err := store.ConsumeState("state-1")
	if err != nil {
		t.Fatalf("ConsumeState failed: %v", err)
	}
	if consumed.CodeVerifier != "verifier" {
		t.Errorf("unexpected consumed state: %+v", consumed)
	}

	// ...and only once (single-use auth codes).
	if _, err := store.ConsumeState("state-1"); !errors.Is(err, ErrInvalidState) {
		t.Errorf("expected ErrInvalidState on second consume, got %v", err)
	}
}

func TestRedisStore_StateTTL(t *testing.T) {
	store, mr := newTestRedisStore(t)

	state := &AuthState{State: "state-ttl", CreatedAt: time.Now()}
	if err := store.StoreState(state); err != nil {
		t.Fatalf("StoreState failed: %v", err)
	}

	mr.FastForward(11 * time.Minute)

	if _, err := store.GetState("state-ttl"); !errors.Is(err, ErrInvalidState) {
		t.Errorf("expected ErrInvalidState after TTL, got %v", err)
	}
	if _, err := store.ConsumeState("state-ttl"); !errors.Is(err, ErrInvalidState) {
		t.Errorf("expected ErrInvalidState after TTL, got %v", err)
	}
}

func TestRedisStore_DeleteState(t *testing.T) {
	store, _ := newTestRedisStore(t)

	state := &AuthState{State: "state-del", CreatedAt: time.Now()}
	if err := store.StoreState(state); err != nil {
		t.Fatalf("StoreState failed: %v", err)
	}
	if err := store.DeleteState("state-del"); err != nil {
		t.Fatalf("DeleteState failed: %v", err)
	}
	if _, err := store.GetState("state-del"); !errors.Is(err, ErrInvalidState) {
		t.Errorf("expected ErrInvalidState after delete, got %v", err)
	}
}

func TestRedisStore_ClientLifecycle(t *testing.T) {
	store, _ := newTestRedisStore(t)

	client := &ClientInfo{
		ClientID:      "dcr-client",
		RedirectURIs:  []string{"https://claude.ai/api/mcp/auth_callback"},
		ClientName:    "Claude",
		GrantTypes:    []string{"authorization_code", "refresh_token"},
		ResponseTypes: []string{"code"},
		CreatedAt:     time.Now(),
	}
	if err := store.StoreClient(client); err != nil {
		t.Fatalf("StoreClient failed: %v", err)
	}

	got, err := store.GetClient("dcr-client")
	if err != nil {
		t.Fatalf("GetClient failed: %v", err)
	}
	if got.ClientName != "Claude" || len(got.RedirectURIs) != 1 {
		t.Errorf("unexpected client: %+v", got)
	}

	if err := store.DeleteClient("dcr-client"); err != nil {
		t.Fatalf("DeleteClient failed: %v", err)
	}
	if _, err := store.GetClient("dcr-client"); !errors.Is(err, ErrClientNotFound) {
		t.Errorf("expected ErrClientNotFound after delete, got %v", err)
	}
}

func TestRedisStore_InvalidURL(t *testing.T) {
	if _, err := NewRedisTokenStore("not-a-url"); err == nil {
		t.Error("expected error for invalid URL")
	}
	// Valid URL, nothing listening: ping must fail rather than defer errors.
	if _, err := NewRedisTokenStore("redis://127.0.0.1:1"); err == nil {
		t.Error("expected connection error")
	}
}

// TestRedisStore_ImplementsInterface ensures RedisTokenStore satisfies TokenStore.
func TestRedisStore_ImplementsInterface(t *testing.T) {
	var _ TokenStore = (*RedisTokenStore)(nil)
}
