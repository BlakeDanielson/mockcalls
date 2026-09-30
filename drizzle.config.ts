import { defineConfig } from "drizzle-kit";

// drizzle-kit doesn't read Next's .env.local on its own.
try {
  process.loadEnvFile(".env.local");
} catch {
  // fall through to whatever is already in the environment
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
