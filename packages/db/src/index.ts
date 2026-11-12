import { createDatabaseClient, type DatabaseOptions } from "./client.ts";
import { createPostgresIngestionStore } from "./postgres-ingestion-store.ts";
import { createPostgresTrackMatchingStore } from "./postgres-track-matching-store.ts";
import { createPostgresSourceRegistry } from "./postgres-source-registry.ts";

export function connectDatabase(connectionString: string, options: DatabaseOptions = {}) {
  const { db, inTransaction, close } = createDatabaseClient(connectionString, options);
  return {
    db,
    store: createPostgresIngestionStore(inTransaction),
    matching: createPostgresTrackMatchingStore(inTransaction),
    sources: createPostgresSourceRegistry(inTransaction),
    close,
  };
}

export { DATABASE_POLICY } from "./policy.ts";
export type { DatabaseLogger } from "./database-logging.ts";
