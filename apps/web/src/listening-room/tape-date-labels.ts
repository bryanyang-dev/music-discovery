const weekdayCodes = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
const weekdayNames = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
const weekdayKanji = ["日", "月", "火", "水", "木", "金", "土"] as const;
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

export interface TapeDateLabels {
  /** 0 = Sunday … 6 = Saturday; selects the tape colour. */
  readonly weekdayIndex: number;
  readonly weekdayCode: string;
  readonly weekdayKanji: string;
  readonly weekdayJapanese: string;
  readonly monthCode: string;
  readonly dayOfMonth: number;
  /** Cassette label, for example "WED 11 NOV". */
  readonly tapeLabel: string;
  /** Short form for the empty box slot, for example "WED 11". */
  readonly slotLabel: string;
  /** Screen-reader form, for example "Wednesday 11 November". */
  readonly spokenDate: string;
}

function labelAt(labels: readonly string[], index: number): string {
  const label = labels[index];
  if (label === undefined) {
    throw new Error(`No label at index ${index}`);
  }
  return label;
}

export function describeTapeDate(isoDate: string): TapeDateLabels {
  const match = isoDatePattern.exec(isoDate);
  if (!match) {
    throw new Error(`Invalid tape date: ${isoDate}`);
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const dayOfMonth = Number(match[3]);
  const utcDate = new Date(Date.UTC(year, monthIndex, dayOfMonth));
  const isRealDate =
    utcDate.getUTCFullYear() === year &&
    utcDate.getUTCMonth() === monthIndex &&
    utcDate.getUTCDate() === dayOfMonth;
  if (!isRealDate) {
    throw new Error(`Invalid tape date: ${isoDate}`);
  }

  const weekdayIndex = utcDate.getUTCDay();
  const weekdayCode = labelAt(weekdayCodes, weekdayIndex);
  const kanji = labelAt(weekdayKanji, weekdayIndex);
  const monthCode = labelAt(monthCodes, monthIndex);
  const paddedDay = String(dayOfMonth).padStart(2, "0");

  return {
    weekdayIndex,
    weekdayCode,
    weekdayKanji: kanji,
    weekdayJapanese: `${kanji}曜日`,
    monthCode,
    dayOfMonth,
    tapeLabel: `${weekdayCode} ${paddedDay} ${monthCode}`,
    slotLabel: `${weekdayCode} ${paddedDay}`,
    spokenDate: `${labelAt(weekdayNames, weekdayIndex)} ${dayOfMonth} ${labelAt(monthNames, monthIndex)}`,
  };
}
