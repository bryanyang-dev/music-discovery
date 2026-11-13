import { createServer } from "node:http";
import { connectDatabase } from "../../../packages/db/src/index.ts";
import {
  IngestionError,
  toIngestionError,
} from "../../../packages/shared/src/index.ts";
import { createTapeApiHandler } from "./tape-api-server.ts";

/** Loopback only: the app is personal and never hosted. Vite proxies /api here. */
const apiHost = "127.0.0.1";
const apiPort = 8787;

function main(): void {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new IngestionError("DATABASE_CONFIG_MISSING");
  }
  const spotifyClientId = process.env.SPOTIFY_CLIENT_ID;
  if (!spotifyClientId) {
    throw new IngestionError("SPOTIFY_CONFIG_INVALID");
  }
  const database = connectDatabase(databaseUrl);
  const handle = createTapeApiHandler({
    tapes: database.tapes,
    spotifyClientId,
  });
  const server = createServer((request, response) => {
    void handle(request, response);
  });
  server.listen(apiPort, apiHost, () => {
    console.log(`Tape API listening on http://${apiHost}:${apiPort}`);
  });
  const shutdown = () => {
    server.close();
    database.close().catch((error: unknown) => {
      console.error(toIngestionError(error).message);
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

try {
  main();
} catch (error) {
  console.error(toIngestionError(error).message);
  process.exitCode = 1;
}
