const monthCodes = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;
const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const millisecondsPerWeek = 7 * 86_400_000;
/** Seven cassette colours, as styled by `[data-tape-color]`. */
const tapeColorCount = 7;

export interface TapeWeekLabels {
  /** 0–6; consecutive weeks get different colours. */
  readonly colorIndex: number;
  readonly monthCode: string;
  readonly dayOfMonth: number;
  /** Cassette label, for example "WK 09 NOV". */
  readonly tapeLabel: string;
  /** Short form for the empty box slot, for example "09 NOV". */
  readonly slotLabel: string;
  /** Screen-reader form, for example "week of 9 November 2026". */
  readonly spokenWeek: string;
}

function labelAt(labels: readonly string[], index: number): string {
  const label = labels[index];
  if (label === undefined) {
    throw new Error(`No label at index ${index}`);
  }
  return label;
}

/** Describes a weekly tape from the Monday (YYYY-MM-DD) that starts its week. */
export function describeTapeWeek(weekStart: string): TapeWeekLabels {
  const match = isoDatePattern.exec(weekStart);
  if (!match) {
    throw new Error(`Invalid tape week: ${weekStart}`);
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const dayOfMonth = Number(match[3]);
  const utcDate = new Date(Date.UTC(year, monthIndex, dayOfMonth));
  const isRealMonday =
    utcDate.getUTCFullYear() === year &&
    utcDate.getUTCMonth() === monthIndex &&
    utcDate.getUTCDate() === dayOfMonth &&
    utcDate.getUTCDay() === 1;
  if (!isRealMonday) {
    throw new Error(`Invalid tape week: ${weekStart}`);
  }

  const weekNumber = Math.floor(utcDate.getTime() / millisecondsPerWeek);
  const monthCode = labelAt(monthCodes, monthIndex);
  const paddedDay = String(dayOfMonth).padStart(2, "0");

  return {
    colorIndex: weekNumber % tapeColorCount,
    monthCode,
    dayOfMonth,
    tapeLabel: `WK ${paddedDay} ${monthCode}`,
    slotLabel: `${paddedDay} ${monthCode}`,
    spokenWeek: `week of ${dayOfMonth} ${labelAt(monthNames, monthIndex)} ${year}`,
  };
}
