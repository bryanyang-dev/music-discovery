import type { Mixtape, Track } from "./models.ts";

export const sampleWeekLengthDays = 7;
export const sampleTracksPerTape = 6;

function toIsoDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function createSampleTracks(): Track[] {
  const tracks: Track[] = [];
  for (let trackNumber = 1; trackNumber <= sampleTracksPerTape; trackNumber += 1) {
    tracks.push({ title: `Sample track ${trackNumber}`, artist: `Sample artist ${trackNumber}` });
  }
  return tracks;
}

/**
 * Placeholder data until the frontend reads real recommendations: one tape per
 * day for the week ending on `today` (local calendar date), newest first.
 */
export function createSampleWeek(today: Date): Mixtape[] {
  const tapes: Mixtape[] = [];
  for (let daysAgo = 0; daysAgo < sampleWeekLengthDays; daysAgo += 1) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo);
    tapes.push({ date: toIsoDate(day), tracks: createSampleTracks() });
  }
  return tapes;
}
