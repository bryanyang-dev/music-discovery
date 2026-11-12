import { connectDatabase } from "@music-discovery/db";
import { getSourceAdapter } from "@music-discovery/rss";
import {
  errorCode,
  IngestionError,
  toIngestionError,
  validateSourceDefinition,
  type SourceDefinition,
  type SourceRegistry,
} from "@music-discovery/shared";

export const SOURCE_ADD_USAGE =
  "pnpm sources:add --key <key> --name <publisher> --category <category> --feed-url <https-url>";

export function parseSourceArgs(args: string[]): SourceDefinition {
  const values = new Map<string, string>();
  const flags = ["--key", "--name", "--category", "--feed-url"];
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]!;
    const value = args[index + 1];
    if (
      !flags.includes(flag) ||
      values.has(flag) ||
      !value ||
      value.startsWith("--")
    ) {
      throw new IngestionError("INVALID_SOURCE");
    }
    values.set(flag, value);
  }
  const source = validateSourceDefinition({
    key: values.get("--key") ?? "",
    name: values.get("--name") ?? "",
    category: values.get("--category") ?? "",
    feedUrl: values.get("--feed-url") ?? "",
  });
  getSourceAdapter(source);
  return source;
}

type RegistryConnection = { sources: SourceRegistry; close(): Promise<void> };

export async function addIngestionSource(
  args: string[],
  databaseUrl: string | undefined,
  connect: (
    url: string,
    options: { sourceKey: string },
  ) => RegistryConnection = connectDatabase,
): Promise<string> {
  const source = parseSourceArgs(args);
  if (!databaseUrl) {
    throw new IngestionError("DATABASE_CONFIG_MISSING");
  }
  const database = connect(databaseUrl, { sourceKey: source.key });
  let primaryFailure: IngestionError | undefined;
  try {
    await database.sources.addSource(source);
    return source.key;
  } catch (error) {
    primaryFailure = toIngestionError(error);
    throw primaryFailure;
  } finally {
    try {
      await database.close();
    } catch (error) {
      if (primaryFailure === undefined) {
        throw error;
      }
      primaryFailure.cleanupErrors.push(errorCode(error));
    }
  }
}
