import type { Mixtape, Track } from "./models.ts";

export class TapeLoadError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`Could not load tapes (${code}).`);
    this.name = "TapeLoadError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseTrack(value: unknown): Track {
  if (
    !isRecord(value) ||
    !isText(value.id) ||
    !isText(value.title) ||
    !isText(value.artist) ||
    typeof value.spotifyUri !== "string" ||
    !/^spotify:track:[A-Za-z0-9]{22}$/.test(value.spotifyUri) ||
    typeof value.sourceUrl !== "string" ||
    !/^https:\/\//.test(value.sourceUrl)
  ) {
    throw new TapeLoadError("INVALID_RESPONSE");
  }
  return {
    id: value.id,
    title: value.title,
    artist: value.artist,
    spotifyUri: value.spotifyUri,
    sourceUrl: value.sourceUrl,
  };
}

/** Validates the local API's `GET /api/tapes` body: newest week first. */
export function parseTapesResponse(body: unknown): Mixtape[] {
  if (!isRecord(body) || !Array.isArray(body.tapes)) {
    throw new TapeLoadError("INVALID_RESPONSE");
  }
  return body.tapes.map((tape: unknown) => {
    if (
      !isRecord(tape) ||
      typeof tape.weekStart !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(tape.weekStart) ||
      !Array.isArray(tape.tracks) ||
      tape.tracks.length === 0
    ) {
      throw new TapeLoadError("INVALID_RESPONSE");
    }
    return { date: tape.weekStart, tracks: tape.tracks.map(parseTrack) };
  });
}

async function getJson(fetcher: typeof fetch, path: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(path, { headers: { accept: "application/json" } });
  } catch {
    throw new TapeLoadError("API_UNREACHABLE");
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new TapeLoadError(
      response.ok ? "INVALID_RESPONSE" : "API_UNREACHABLE",
    );
  }
  if (!response.ok) {
    throw new TapeLoadError(
      isRecord(body) && isText(body.code)
        ? body.code
        : `HTTP_${response.status}`,
    );
  }
  return body;
}

export async function fetchTapes(
  fetcher: typeof fetch = fetch,
): Promise<Mixtape[]> {
  return parseTapesResponse(await getJson(fetcher, "/api/tapes"));
}

export async function fetchSpotifyClientId(
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const body = await getJson(fetcher, "/api/spotify-config");
  if (!isRecord(body) || !isText(body.clientId)) {
    throw new TapeLoadError("INVALID_RESPONSE");
  }
  return body.clientId;
}
