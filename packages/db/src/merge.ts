import { createHash } from "node:crypto";
import type { TrackInput } from "@music-discovery/shared";

export function mergeTrack(incoming: TrackInput, previous?: TrackInput): TrackInput {
  return {
    ...incoming,
    sourceGuid: incoming.sourceGuid ?? previous?.sourceGuid ?? null,
    reviewTitle: incoming.reviewTitle ?? previous?.reviewTitle ?? null,
    reviewAuthor: incoming.reviewAuthor ?? previous?.reviewAuthor ?? null,
    reviewPublishedAt: incoming.reviewPublishedAt ?? previous?.reviewPublishedAt ?? null,
    summary: incoming.summary ?? previous?.summary ?? null,
    imageUrl: incoming.imageUrl ?? previous?.imageUrl ?? null,
    genres: incoming.genres.length ? incoming.genres : previous?.genres ?? [],
    labels: incoming.labels.length ? incoming.labels : previous?.labels ?? [],
    releaseDate: incoming.releaseDate ?? previous?.releaseDate ?? null,
  };
}

export function metadataHash(track: TrackInput): string {
  return createHash("sha256").update(JSON.stringify([
    track.trackTitle, track.artists, track.sourceGuid, track.reviewTitle,
    track.reviewAuthor, track.reviewPublishedAt?.toISOString() ?? null,
    track.summary, track.imageUrl, track.genres, track.labels, track.releaseDate,
  ])).digest("hex");
}

