import { createDatabaseClient, type DatabaseOptions } from "./client.ts";
import { createPostgresIngestionStore } from "./postgres-ingestion-store.ts";

export function connectDatabase(connectionString: string, options: DatabaseOptions = {}) {
  const { db, inTransaction, close } = createDatabaseClient(connectionString, options);
  return { db, store: createPostgresIngestionStore(inTransaction), close };
}

export { DATABASE_POLICY } from "./policy.ts";
