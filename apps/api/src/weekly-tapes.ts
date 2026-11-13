import type { TapeTrack } from "../../../packages/shared/src/index.ts";

export interface WeeklyTapeTrack {
  id: string;
  title: string;
  /** Editorial artists joined for display. */
  artist: string;
  spotifyUri: string;
  sourceUrl: string;
  recommendedAt: string;
}

export interface WeeklyTape {
  /** Monday (UTC) that starts the review week, as YYYY-MM-DD; identifies the tape. */
  weekStart: string;
  /** Oldest recommendation first, so the tape plays in the order the week unfolded. */
  tracks: WeeklyTapeTrack[];
}

const millisecondsPerDay = 86_400_000;

export function weekStartOf(date: Date): string {
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  const monday = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) -
      daysSinceMonday * millisecondsPerDay,
  );
  return monday.toISOString().slice(0, 10);
}

/**
 * Groups matched tracks into one tape per UTC review week and returns the
 * `maxTapes` most recent weeks that have tracks, newest first. A Spotify
 * recording credited more than once in a week appears once.
 */
export function groupIntoWeeklyTapes(
  tracks: readonly TapeTrack[],
  maxTapes: number,
): WeeklyTape[] {
  const byWeek = new Map<string, TapeTrack[]>();
  for (const track of tracks) {
    const weekStart = weekStartOf(track.recommendedAt);
    const week = byWeek.get(weekStart) ?? [];
    week.push(track);
    byWeek.set(weekStart, week);
  }
  return [...byWeek.keys()]
    .sort()
    .reverse()
    .slice(0, maxTapes)
    .map((weekStart) => {
      const seenRecordings = new Set<string>();
      const weekTracks = [...byWeek.get(weekStart)!]
        .sort(
          (left, right) =>
            left.recommendedAt.getTime() - right.recommendedAt.getTime() ||
            left.id.localeCompare(right.id),
        )
        .filter((track) => {
          if (seenRecordings.has(track.providerTrackId)) {
            return false;
          }
          seenRecordings.add(track.providerTrackId);
          return true;
        });
      return {
        weekStart,
        tracks: weekTracks.map((track) => ({
          id: track.id,
          title: track.trackTitle,
          artist: track.artists.join(", "),
          spotifyUri: `spotify:track:${track.providerTrackId}`,
          sourceUrl: track.sourceUrl,
          recommendedAt: track.recommendedAt.toISOString(),
        })),
      };
    });
}
