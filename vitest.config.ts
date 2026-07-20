import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Mirror wrangler's Text module rules so `import doc from "./x.md"` works in
// tests the same way it does in the Workers bundle.
export default defineConfig({
  plugins: [
    {
      name: "text-imports",
      load(id) {
        if (id.endsWith(".md") || id.endsWith(".txt")) {
          return `export default ${JSON.stringify(readFileSync(id, "utf8"))};`;
        }
      },
    },
  ],
});
