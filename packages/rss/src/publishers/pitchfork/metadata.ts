import {
  IngestionError,
  type FeedEntry,
  type TrackInput,
} from "@music-discovery/shared";
import {
  attribute,
  imageUrl,
  plainText,
  unquoteTitle,
  validDate,
} from "../../text.ts";

import { pitchforkUrl } from "./urls.ts";

const MAX_STRUCTURED_NODE_COUNT = 1_000;
const ARTIST_LINK_CLASS_PATTERN =
  /\bSplitScreenContentHeaderArtistLink(?:-|\b)/;
const ISO_DATE_CHARACTER_COUNT = 10;

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

function hasType(value: JsonObject, expected: string): boolean {
  const types = Array.isArray(value["@type"])
    ? value["@type"]
    : [value["@type"]];
  return types.some((type) => {
    return (
      typeof type === "string" &&
      type.replace(/^https?:\/\/schema.org\//, "") === expected
    );
  });
}

function extractNames(value: unknown): string[] {
  let values: unknown[] = [];
  if (Array.isArray(value)) {
    values = value;
  } else if (value != null) {
    values = [value];
  }

  const names: string[] = [];
  for (const item of values) {
    const nameValue = typeof item === "string" ? item : asObject(item)?.name;
    if (typeof nameValue !== "string") {
      continue;
    }
    const name = plainText(nameValue);
    if (name) {
      names.push(name);
    }
  }
  return [...new Set(names)];
}

function structuredNodes(html: string): JsonObject[] {
  const nodes: JsonObject[] = [];
  for (const match of html.matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
  )) {
    if (
      attribute(match[1] ?? "", "type")?.toLowerCase() !== "application/ld+json"
    ) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(match[2] ?? "");
    } catch {
      continue;
    }

    const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
    for (
      let position = 0;
      position < queue.length && position < MAX_STRUCTURED_NODE_COUNT;
      position++
    ) {
      const node = asObject(queue[position]);
      if (!node) {
        continue;
      }

      nodes.push(node);
      if (Array.isArray(node["@graph"])) {
        queue.push(...node["@graph"]);
      }
    }
  }
  return nodes;
}

function headerArtists(html: string): string[] {
  const artists: string[] = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const attributes = match[1] ?? "";
    if (!ARTIST_LINK_CLASS_PATTERN.test(attribute(attributes, "class") ?? "")) {
      continue;
    }

    const href = attribute(attributes, "href");
    if (!href) {
      continue;
    }
    try {
      pitchforkUrl(href, "artist", "https://pitchfork.com");
    } catch {
      continue;
    }

    const name = plainText(match[2]);
    if (name) {
      artists.push(name);
    }
  }
  return [...new Set(artists)];
}

function infoSlices(html: string, label: string): string[] {
  const values: string[] = [];
  for (const match of html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi)) {
    const block = match[1] ?? "";
    const key = block.match(
      /<p\b[^>]*class=["'][^"']*InfoSliceKey[^"']*["'][^>]*>([\s\S]*?)<\/p>/i,
    );
    if (plainText(key?.[1]) !== label + ":") {
      continue;
    }

    const value = block.match(
      /<p\b[^>]*class=["'][^"']*InfoSliceValue[^"']*["'][^>]*>([\s\S]*?)<\/p>/i,
    );
    const text = plainText(value?.[1]);
    if (text) {
      values.push(text);
    }
  }
  return [...new Set(values)];
}

function recordingReleaseDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const normalizedDate = validDate(value)
    ?.toISOString()
    .slice(0, ISO_DATE_CHARACTER_COUNT);
  return normalizedDate === value ? value : null;
}

function canonicalReviewUrl(html: string, pageUrl: string): string {
  for (const match of html.matchAll(/<link\b([^>]*)>/gi)) {
    const attributes = match[1] ?? "";
    if (attribute(attributes, "rel")?.toLowerCase() !== "canonical") {
      continue;
    }

    const href = attribute(attributes, "href");
    return href ? pitchforkUrl(href, "review", pageUrl) : pageUrl;
  }
  return pageUrl;
}

function selectReview(html: string, acceptedUrls: string[]): JsonObject {
  const candidates = structuredNodes(html).filter((node) => {
    if (!hasType(node, "Review")) {
      return false;
    }
    const recording = asObject(node.itemReviewed);
    return recording !== null && hasType(recording, "MusicRecording");
  });

  const matched = candidates.find((node) => {
    if (typeof node.url !== "string") {
      return false;
    }
    try {
      return acceptedUrls.includes(pitchforkUrl(node.url));
    } catch {
      return false;
    }
  });
  if (matched) {
    return matched;
  }

  const soleCandidate = candidates[0];
  if (candidates.length === 1 && soleCandidate && soleCandidate.url == null) {
    return soleCandidate;
  }
  throw new IngestionError("INVALID_METADATA");
}

export function extractPitchforkTrack(
  entry: FeedEntry,
  html: string,
  pageUrl = entry.sourceUrl,
): TrackInput {
  const finalUrl = pitchforkUrl(pageUrl);
  const canonicalUrl = canonicalReviewUrl(html, finalUrl);
  const review = selectReview(html, [canonicalUrl, finalUrl]);
  const recording = asObject(review.itemReviewed);
  if (!recording) {
    throw new IngestionError("INVALID_METADATA");
  }
  const structuredArtists = extractNames(recording.byArtist);
  const artists =
    structuredArtists.length > 0 ? structuredArtists : headerArtists(html);
  if (artists.length === 0) {
    throw new IngestionError("MISSING_METADATA");
  }

  const headline = typeof review.headline === "string" ? review.headline : null;
  const rawTitle = plainText(headline) ?? entry.reviewTitle;
  let trackTitle = rawTitle ? unquoteTitle(rawTitle) : "";
  if (!trackTitle && typeof recording.name === "string") {
    const artistPrefix = artists.join(" / ") + ": ";
    const recordingTitle = recording.name.startsWith(artistPrefix)
      ? recording.name.slice(artistPrefix.length)
      : recording.name;
    trackTitle = unquoteTitle(recordingTitle);
  }
  if (!trackTitle) {
    throw new IngestionError("MISSING_METADATA");
  }

  const reviewAuthor = extractNames(review.author).join(", ") || null;
  const structuredImage =
    asObject(recording.image)?.url ??
    asObject(review.image)?.url ??
    recording.image ??
    review.image;
  const structuredGenres = extractNames(recording.genre);
  const structuredLabels = extractNames(recording.recordLabel);

  return {
    ...entry,
    sourceUrl: canonicalUrl,
    trackTitle,
    artists,
    reviewTitle: entry.reviewTitle ?? rawTitle,
    reviewAuthor: reviewAuthor ?? entry.reviewAuthor,
    reviewPublishedAt:
      validDate(review.datePublished) ?? entry.reviewPublishedAt,
    imageUrl: entry.imageUrl ?? imageUrl(structuredImage),
    genres:
      structuredGenres.length > 0
        ? structuredGenres
        : infoSlices(html, "Genre"),
    labels:
      structuredLabels.length > 0
        ? structuredLabels
        : infoSlices(html, "Label"),
    releaseDate: recordingReleaseDate(recording.datePublished),
  };
}
