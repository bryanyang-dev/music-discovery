import { createHash } from "node:crypto";
import { IngestionError } from "./errors.ts";

export const PITCHFORK_FEED_URL = "https://pitchfork.com/feed/reviews/best/tracks/rss";
export const PITCHFORK_SOURCE_KEY = "pitchfork_best_new_tracks";

export function httpUrl(value: string, base?: string): string {
  const url = new URL(value, base);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new IngestionError("UNSAFE_URL");
  }
  url.hash = "";
  return url.href;
}

export function pitchforkUrl(value: string, kind: "feed" | "review" | "artist" = "review", base?: string): string {
  let url: URL;
  try {
    url = new URL(httpUrl(value, base));
  } catch {
    throw new IngestionError("UNSAFE_URL");
  }
  if (url.protocol !== "https:" || !["pitchfork.com", "www.pitchfork.com"].includes(url.hostname) || url.port) {
    throw new IngestionError("UNSAFE_URL");
  }
  url.hostname = "pitchfork.com";
  if (/%2f|%5c|\\/i.test(url.pathname)) {
    throw new IngestionError("UNSAFE_URL");
  }
  let validPath: boolean;
  if (kind === "feed") {
    validPath = url.pathname.replace(/\/$/, "") === "/feed/reviews/best/tracks/rss";
  } else if (kind === "artist") {
    validPath = /^\/artists\/[^/]+\/$/.test(url.pathname);
  } else {
    validPath = /^\/reviews\/(?!best(?:\/|$))[^?#]+\/$/.test(url.pathname);
  }
  if (!validPath) {
    throw new IngestionError("UNSAFE_URL");
  }
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key) || ["fbclid", "gclid", "mc_cid", "mc_eid"].includes(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  if (kind === "feed" && url.search) {
    throw new IngestionError("UNSAFE_URL");
  }
  return url.href;
}

export function safeLogUrl(value: string): string | null {
  try {
    const url = new URL(pitchforkUrl(value));
    return url.origin + url.pathname;
  } catch {
    return null;
  }
}

export function sourceKey(identity: string): string {
  return createHash("sha256").update(identity).digest("hex");
}
