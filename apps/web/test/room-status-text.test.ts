import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describeSpotifyStatus,
  describeTapeLoadError,
} from "../src/listening-room/room-status-text.ts";

test("offers sign-in only when signed out or expired", () => {
  assert.equal(
    describeSpotifyStatus("signed_out").connectLabel,
    "Connect Spotify",
  );
  assert.equal(describeSpotifyStatus("auth_failed").connectLabel, "Reconnect");
  for (const status of [
    "connecting",
    "ready",
    "starting",
    "offline",
    "premium_required",
    "unsupported_browser",
    "playback_failed",
  ] as const) {
    assert.equal(describeSpotifyStatus(status).connectLabel, null, status);
  }
});

test("explains an unreachable API and falls back to the safe code", () => {
  assert.match(describeTapeLoadError("API_UNREACHABLE"), /pnpm api:dev/);
  assert.equal(
    describeTapeLoadError("DATABASE_TIMEOUT"),
    "Couldn't load tapes (DATABASE_TIMEOUT).",
  );
});

test("failures show Spotify's explanation; other states ignore stale details", () => {
  assert.equal(
    describeSpotifyStatus("playback_failed", "HTTP 403: PREMIUM_REQUIRED")
      .message,
    "Spotify couldn't play that (HTTP 403: PREMIUM_REQUIRED)",
  );
  assert.equal(
    describeSpotifyStatus("ready", "HTTP 404").message,
    "Spotify connected",
  );
});
