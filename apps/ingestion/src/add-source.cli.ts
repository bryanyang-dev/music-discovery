import { toIngestionError } from "@music-discovery/shared";
import { addIngestionSource, SOURCE_ADD_USAGE } from "./source-registration.ts";

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  console.log(SOURCE_ADD_USAGE);
} else {
  addIngestionSource(args, process.env.DATABASE_URL).then((key) => {
    console.log(`Registered ingestion source: ${key}`);
  }).catch((error: unknown) => {
    console.error(toIngestionError(error).message);
    console.error(SOURCE_ADD_USAGE);
    process.exitCode = 1;
  });
}
