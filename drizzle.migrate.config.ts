import { defineConfig } from "drizzle-kit";
import config from "./drizzle.config.ts";
import { databaseSsl } from "./packages/db/src/connection.ts";

const connectionString = process.env.DATABASE_MIGRATION_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_MIGRATION_URL is required; use the direct or session connection",
  );
}
const ssl = databaseSsl(connectionString, {
  allowLocalNoTls: process.env.DATABASE_MIGRATION_ALLOW_LOCAL_NO_TLS === "1",
});
const url = new URL(connectionString);
// Override URL options so they cannot weaken the selected TLS policy.
url.searchParams.delete("sslrootcert");
url.searchParams.set("sslmode", ssl === false ? "disable" : "verify-full");
url.searchParams.set("connect_timeout", "10");
url.searchParams.set("prepare", "false");

export default defineConfig({
  ...config,
  dbCredentials: { url: url.href },
});
