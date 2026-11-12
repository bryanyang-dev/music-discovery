import {
  IngestionError,
  type MatchingTrack,
  type SpotifyMatch,
} from "../../../../packages/shared/src/index.ts";
import { spotifyJson, type SpotifyLoggingOptions } from "./http.ts";

interface SpotifyConfiguration {
  clientId: string;
  clientSecret: string;
  market: string;
}
interface Recording {
  id: string;
  name: string;
  artists: { name: string }[];
}
const SEARCH_RESULT_LIMIT = 10;
const MAX_SEARCH_PAGES = 5;

function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeTitle(title: string): string {
  const normalized = normalize(title);
  // A release label does not identify a different performance or mix.
  const withoutBonusLabel = normalized
    .replace(
      /(?: [-–—] bonus track| \( *bonus track *\)| \[ *bonus track *\])$/u,
      "",
    )
    .trim();
  return withoutBonusLabel || normalized;
}

function parseRecording(value: unknown): Recording {
  if (value === null || typeof value !== "object")
    throw new IngestionError("SPOTIFY_REQUEST_FAILED");
  const recording = value as Partial<Recording>;
  if (
    typeof recording.id !== "string" ||
    !/^[A-Za-z0-9]{22}$/.test(recording.id) ||
    typeof recording.name !== "string" ||
    !recording.name.trim() ||
    !Array.isArray(recording.artists) ||
    !recording.artists.length ||
    recording.artists.some(
      (artist) =>
        !artist || typeof artist.name !== "string" || !artist.name.trim(),
    )
  ) {
    throw new IngestionError("SPOTIFY_REQUEST_FAILED");
  }
  return recording as Recording;
}

export async function searchSpotify(
  track: MatchingTrack,
  configuration: SpotifyConfiguration,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  logging: SpotifyLoggingOptions = {},
): Promise<SpotifyMatch> {
  if (
    !configuration.clientId.trim() ||
    !configuration.clientSecret.trim() ||
    !/^[A-Z]{2}$/.test(configuration.market)
  ) {
    throw new IngestionError("SPOTIFY_CONFIG_INVALID");
  }
  const tokenData = (await spotifyJson(
    fetcher,
    "https://accounts.spotify.com/api/token",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${configuration.clientId}:${configuration.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    },
    signal,
    { ...logging, operation: "token", trackId: track.id },
  )) as { access_token?: unknown } | null;
  if (
    !tokenData ||
    typeof tokenData.access_token !== "string" ||
    !tokenData.access_token.trim()
  ) {
    throw new IngestionError("SPOTIFY_AUTH_ERROR");
  }
  // Strip query syntax from editorial metadata; title/artist equality is checked locally.
  const queryText = (text: string) =>
    text
      .replace(/["\\:]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const query = `track:"${queryText(track.trackTitle)}" artist:"${queryText(track.artists[0] ?? "")}"`;
  const candidates = new Map<string, Recording>();
  const expectedArtists = [...new Set(track.artists.map(normalize))].sort();
  let complete = false;
  for (let page = 0; page < MAX_SEARCH_PAGES; page++) {
    const url = new URL("https://api.spotify.com/v1/search");
    url.search = new URLSearchParams({
      q: query,
      type: "track",
      market: configuration.market,
      limit: String(SEARCH_RESULT_LIMIT),
      offset: String(page * SEARCH_RESULT_LIMIT),
    }).toString();
    const data = (await spotifyJson(
      fetcher,
      url.href,
      {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      },
      signal,
      {
        ...logging,
        operation: "search",
        trackId: track.id,
        offset: page * SEARCH_RESULT_LIMIT,
      },
    )) as { tracks?: { items?: unknown; next?: unknown } } | null;
    if (
      !data?.tracks ||
      !Array.isArray(data.tracks.items) ||
      (data.tracks.next !== null && typeof data.tracks.next !== "string")
    ) {
      throw new IngestionError("SPOTIFY_REQUEST_FAILED");
    }
    for (const value of data.tracks.items) {
      const recording = parseRecording(value);
      const artists = [
        ...new Set(recording.artists.map((artist) => normalize(artist.name))),
      ].sort();
      if (
        normalizeTitle(recording.name) === normalizeTitle(track.trackTitle) &&
        JSON.stringify(artists) === JSON.stringify(expectedArtists)
      ) {
        candidates.set(recording.id, recording);
      }
    }
    if (candidates.size > 1) return { status: "ambiguous" };
    if (data.tracks.next === null) {
      complete = true;
      break;
    }
  }
  // An incomplete search cannot establish a unique result or absence.
  if (!complete) return { status: "ambiguous" };
  const recording = [...candidates.values()][0];
  if (!recording) return { status: "not_found" };
  return {
    status: "matched",
    providerTrackId: recording.id,
    providerUrl: `https://open.spotify.com/track/${recording.id}`,
    providerTitle: recording.name,
    providerArtists: recording.artists.map((artist) => artist.name),
  };
}
