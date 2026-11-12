import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeTrack, metadataHash } from "../src/merge.ts";
import type { TrackInput } from "@music-discovery/shared";

const track: TrackInput = {
  sourceUrl: "https://pitchfork.com/reviews/tracks/example/",
  sourceGuid: "guid",
  trackTitle: "Track",
  artists: ["Band & Guest"],
  reviewTitle: "Track",
  reviewAuthor: "Critic",
  reviewPublishedAt: new Date("2026-11-10T12:00:00Z"),
  summary: "Summary",
  imageUrl: "https://media.pitchfork.com/example.jpg",
  genres: ["Pop"],
  labels: ["Label"],
  releaseDate: "2026-10-01",
};
test("missing optional fields do not erase metadata or alter its content hash", () => {
  const sparse: TrackInput = {
    ...track,
    sourceGuid: null,
    reviewTitle: null,
    reviewAuthor: null,
    reviewPublishedAt: null,
    summary: null,
    imageUrl: null,
    genres: [],
    labels: [],
    releaseDate: null,
  };
  assert.deepEqual(mergeTrack(sparse, track), track);
  assert.equal(metadataHash(mergeTrack(sparse, track)), metadataHash(track));
});
test("new supplied metadata replaces old fields and changes the content hash", () => {
  const changed = mergeTrack(
    { ...track, trackTitle: "Updated", artists: ["New Artist"] },
    track,
  );
  assert.equal(changed.trackTitle, "Updated");
  assert.notEqual(metadataHash(changed), metadataHash(track));
});
