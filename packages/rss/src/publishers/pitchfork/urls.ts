import { httpUrl, IngestionError } from "@music-discovery/shared";

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
    validPath = /^\/feed\/[^?#]+$/.test(url.pathname);
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
  return url.href;
}
