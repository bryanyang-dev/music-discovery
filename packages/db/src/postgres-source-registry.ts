import {
  IngestionError,
  validateSourceDefinition,
  type SourceRegistry,
} from "@music-discovery/shared";
import { ingestionSources } from "./schema.ts";
import type { InTransaction } from "./client.ts";

export function createPostgresSourceRegistry(
  inTransaction: InTransaction,
): SourceRegistry {
  return {
    async addSource(input) {
      const source = validateSourceDefinition(input);
      await inTransaction("addSource", async (transaction, query) => {
        const inserted = await query(
          "insert_source",
          transaction
            .insert(ingestionSources)
            .values(source)
            .onConflictDoNothing({ target: ingestionSources.key })
            .returning({ id: ingestionSources.id }),
        );
        if (inserted.length === 0) {
          throw new IngestionError("SOURCE_ALREADY_EXISTS");
        }
      });
    },
  };
}
