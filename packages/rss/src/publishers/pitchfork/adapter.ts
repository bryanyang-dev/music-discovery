import { IngestionError } from "@music-discovery/shared";
import { pitchforkUrl } from "./urls.ts";
import { fetchPitchforkFeed } from "./feed.ts";
import { requestPitchfork } from "./http.ts";
import { extractPitchforkTrack } from "./metadata.ts";
import type { SourceAdapter } from "../../source-adapter.interface.ts";

export const pitchforkAdapter: SourceAdapter = {
  validateSource(source) {
    if (source.category !== "best_new_track") {
      throw new IngestionError("UNSUPPORTED_SOURCE");
    }
    pitchforkUrl(source.feedUrl, "feed");
  },
  fetchFeed: fetchPitchforkFeed,
  async extractTrack(entry, options) {
    const page = await requestPitchfork(entry.sourceUrl, "review", {}, options);
    return extractPitchforkTrack(entry, page.body, page.url);
  },
};
