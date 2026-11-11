import Parser from "rss-parser";
import { IngestionError, pitchforkUrl, safeLogUrl, type CacheValidators, type FeedEntry, type RunIssue } from "@music-discovery/shared";
import { imageUrl, plainText, validDate } from "./text.ts";
import { requestPitchfork, type HttpOptions } from "./http.ts";

export { requestPitchfork, type HttpOptions } from "./http.ts";
export { extractTrack } from "./metadata.ts";

const MAX_FEED_ENTRY_COUNT = 100;
const EXPECTED_FEED_TITLE = "Best New Tracks";

interface CustomItem {
  thumbnail?: { $?: { url?: string } };
}

export interface ParsedFeed {
  entries: FeedEntry[];
  found: number;
  duplicates: number;
  errors: RunIssue[];
}

export async function parseFeed(xml: string): Promise<ParsedFeed> {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new IngestionError("INVALID_FEED");
  }
  if (/<\?xml[^>]*encoding\s*=\s*["'](?!utf-?8["']|us-ascii["'])/i.test(xml)) {
    throw new IngestionError("UNSUPPORTED_ENCODING");
  }
  let feed;
  try {
    feed = await new Parser<Record<string, never>, CustomItem>({
      customFields: { item: [["media:thumbnail", "thumbnail"]] },
    }).parseString(xml);
  } catch {
    throw new IngestionError("INVALID_FEED");
  }
  if (feed.title?.trim() !== EXPECTED_FEED_TITLE) {
    throw new IngestionError("INVALID_FEED");
  }
  if (feed.items.length > MAX_FEED_ENTRY_COUNT) {
    throw new IngestionError("INVALID_FEED");
  }
  const entries = new Map<string, FeedEntry>();
  const errors: RunIssue[] = [];
  let duplicates = 0;
  for (const item of feed.items) {
    let sourceUrl: string;
    try {
      sourceUrl = pitchforkUrl(item.link?.trim() ?? "");
    } catch {
      errors.push({ code: "INVALID_ENTRY", sourceUrl: null });
      continue;
    }
    if (!plainText(item.title)) {
      errors.push({ code: "INVALID_ENTRY", sourceUrl: safeLogUrl(sourceUrl) });
      continue;
    }
    if (entries.has(sourceUrl)) {
      duplicates++;
    }
    entries.set(sourceUrl, {
      sourceUrl,
      sourceGuid: plainText(item.guid),
      reviewTitle: plainText(item.title),
      reviewAuthor: plainText(item.creator),
      reviewPublishedAt: validDate(item.isoDate || item.pubDate),
      summary: plainText(item.contentSnippet || item.content),
      imageUrl: imageUrl(item.thumbnail?.$?.url),
    });
  }
  return { entries: [...entries.values()], found: feed.items.length, duplicates, errors };
}

export type FeedResponse =
  | { notModified: true; validators: CacheValidators }
  | { notModified: false; validators: CacheValidators; feed: ParsedFeed };

export async function fetchFeed(
  url: string, validators: CacheValidators, options: HttpOptions = {},
): Promise<FeedResponse> {
  const headers: Record<string, string> = {};
  if (validators.etag) {
    headers["If-None-Match"] = validators.etag;
  }
  if (validators.lastModified) {
    headers["If-Modified-Since"] = validators.lastModified;
  }
  const response = await requestPitchfork(url, "feed", headers, options);
  if (response.status === 304) {
    if (!validators.etag && !validators.lastModified) {
      throw new IngestionError("INVALID_FEED");
    }
    return {
      notModified: true,
      validators: {
        etag: response.etag ?? validators.etag,
        lastModified: response.lastModified ?? validators.lastModified,
      },
    };
  }
  return {
    notModified: false,
    validators: { etag: response.etag, lastModified: response.lastModified },
    feed: await parseFeed(response.body),
  };
}

