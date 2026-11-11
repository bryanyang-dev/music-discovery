import { IngestionError } from "@music-discovery/shared";

interface ConnectionOptions {
  allowLocalNoTls?: boolean;
}

export function databaseSsl(
  connectionString: string,
  options: ConnectionOptions = {},
): false | "verify-full" {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new IngestionError("DATABASE_CONFIG_INVALID");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new IngestionError("DATABASE_CONFIG_INVALID");
  }
  if (!options.allowLocalNoTls) {
    return "verify-full";
  }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new IngestionError("DATABASE_CONFIG_INVALID");
  }
  return false;
}
