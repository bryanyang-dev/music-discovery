import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const MIGRATION_CONNECT_TIMEOUT_SECONDS = 10;
const MIGRATION_CLOSE_TIMEOUT_SECONDS = 5;

const url = process.env.DATABASE_MIGRATION_URL;
if (!url) {
  throw new Error("DATABASE_MIGRATION_URL is required; use the direct or session connection");
}
const client = postgres(url, {
  prepare: false,
  max: 1,
  ssl: "verify-full",
  connect_timeout: MIGRATION_CONNECT_TIMEOUT_SECONDS,
});
try {
  await migrate(drizzle(client), {
    migrationsFolder: fileURLToPath(new URL("../migrations/", import.meta.url)),
  });
  console.log("Database migrations applied");
} catch {
  console.error("Migration failed. Check connection settings and database permissions; credentials were not logged.");
  process.exitCode = 1;
} finally {
  try {
    await client.end({ timeout: MIGRATION_CLOSE_TIMEOUT_SECONDS });
  } catch {
    console.error("Migration connection cleanup failed; credentials were not logged.");
    process.exitCode = 1;
  }
}

