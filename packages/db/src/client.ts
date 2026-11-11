import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { boundDatabaseOperation } from "./deadline.ts";
import { DATABASE_POLICY } from "./policy.ts";
import { databaseSsl } from "./connection.ts";
import { databaseError } from "./errors.ts";
import { createDatabaseCallLogger, type DatabaseLoggingOptions, type QueryExecutor } from "./database-logging.ts";

export type Transaction = Parameters<Parameters<ReturnType<typeof drizzle>["transaction"]>[0]>[0];

export interface DatabaseOptions extends DatabaseLoggingOptions {
  localTest?: boolean;
  signal?: AbortSignal;
}

interface TransactionOptions {
  phase?: "work" | "cleanup";
}

export function createDatabaseClient(connectionString: string, options: DatabaseOptions = {}) {
  const ssl = databaseSsl(connectionString, { allowLocalNoTls: options.localTest ?? false });
  const client = postgres(connectionString, {
    prepare: false,
    max: DATABASE_POLICY.maxConnectionCount,
    ssl,
    connect_timeout: DATABASE_POLICY.connectTimeoutSeconds,
    idle_timeout: DATABASE_POLICY.idleTimeoutSeconds,
    connection: { application_name: "music-discovery-ingestion" },
  });
  const db = drizzle(client);
  const logDatabaseCall = createDatabaseCallLogger(options);

  async function inTransaction<Result>(
    operation: string,
    work: (transaction: Transaction, query: QueryExecutor) => Promise<Result>,
    transactionOptions: TransactionOptions = {},
  ): Promise<Result> {
    const isCleanup = transactionOptions.phase === "cleanup";
    const deadlineOptions = !isCleanup && options.signal ? { signal: options.signal } : {};

    return logDatabaseCall({ scope: "transaction", operation }, async (parentCallId) => {
      return boundDatabaseOperation(
        () => db.transaction(async (transaction) => {
          const query: QueryExecutor = (queryOperation, statement) => logDatabaseCall(
            { scope: "query", operation: queryOperation, parentCallId },
            async () => statement,
          );
          await query("set_statement_timeout", transaction.execute(
            sql`SELECT set_config('statement_timeout', ${String(DATABASE_POLICY.statementTimeoutMs)}, true)`,
          ));
          await query("set_lock_timeout", transaction.execute(
            sql`SELECT set_config('lock_timeout', ${String(DATABASE_POLICY.lockTimeoutMs)}, true)`,
          ));
          return work(transaction, query);
        }),
        () => logDatabaseCall({ scope: "connection", operation: "terminate", parentCallId },
          () => client.end({ timeout: DATABASE_POLICY.forceCloseTimeoutSeconds })),
        deadlineOptions,
      ).catch((error: unknown) => {
        throw databaseError(error);
      });
    });
  }

  return {
    db,
    inTransaction,
    async close() {
      try {
        await logDatabaseCall({ scope: "connection", operation: "close" },
          () => client.end({ timeout: DATABASE_POLICY.closeTimeoutSeconds }));
      } catch (error) {
        throw databaseError(error);
      }
    },
  };
}

export type InTransaction = ReturnType<typeof createDatabaseClient>["inTransaction"];
