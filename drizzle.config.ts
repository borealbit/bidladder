import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  out: "./migrations",
  schema: "./database/schema.ts",
  strict: true,
  verbose: true,
});
