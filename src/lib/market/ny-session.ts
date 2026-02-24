const NY_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

function extractPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? "";
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function dayKey(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number): number {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const offset = (weekday - firstWeekday + 7) % 7;
  return 1 + offset + (nth - 1) * 7;
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): number {
  const end = new Date(Date.UTC(year, month, 0));
  const diff = (end.getUTCDay() - weekday + 7) % 7;
  return end.getUTCDate() - diff;
}

function observedFixedHoliday(year: number, month: number, day: number): { year: number; month: number; day: number } {
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay();
  if (weekday === 6) {
    date.setUTCDate(date.getUTCDate() - 1);
  } else if (weekday === 0) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

function nyseHolidayKeys(year: number): Set<string> {
  const keys = new Set<string>();

  const newYear = observedFixedHoliday(year, 1, 1);
  keys.add(dayKey(newYear.year, newYear.month, newYear.day));

  keys.add(dayKey(year, 1, nthWeekdayOfMonth(year, 1, 1, 3))); // MLK Day
  keys.add(dayKey(year, 2, nthWeekdayOfMonth(year, 2, 1, 3))); // Presidents Day

  const easter = easterSunday(year);
  const goodFriday = new Date(Date.UTC(year, easter.month - 1, easter.day));
  goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);
  keys.add(dayKey(goodFriday.getUTCFullYear(), goodFriday.getUTCMonth() + 1, goodFriday.getUTCDate()));

  keys.add(dayKey(year, 5, lastWeekdayOfMonth(year, 5, 1))); // Memorial Day

  const juneteenth = observedFixedHoliday(year, 6, 19);
  keys.add(dayKey(juneteenth.year, juneteenth.month, juneteenth.day));

  const independence = observedFixedHoliday(year, 7, 4);
  keys.add(dayKey(independence.year, independence.month, independence.day));

  keys.add(dayKey(year, 9, nthWeekdayOfMonth(year, 9, 1, 1))); // Labor Day
  keys.add(dayKey(year, 11, nthWeekdayOfMonth(year, 11, 4, 4))); // Thanksgiving

  const christmas = observedFixedHoliday(year, 12, 25);
  keys.add(dayKey(christmas.year, christmas.month, christmas.day));

  return keys;
}

function isNyHoliday(parts: Intl.DateTimeFormatPart[]): boolean {
  const year = Number.parseInt(extractPart(parts, "year"), 10);
  const month = Number.parseInt(extractPart(parts, "month"), 10);
  const day = Number.parseInt(extractPart(parts, "day"), 10);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return false;
  }

  const key = dayKey(year, month, day);
  return (
    nyseHolidayKeys(year - 1).has(key) || nyseHolidayKeys(year).has(key) || nyseHolidayKeys(year + 1).has(key)
  );
}

export function isNySessionOpen(date = new Date()): boolean {
  const parts = NY_TIME_FORMATTER.formatToParts(date);
  const weekday = extractPart(parts, "weekday");
  const hour = Number.parseInt(extractPart(parts, "hour"), 10);
  const minute = Number.parseInt(extractPart(parts, "minute"), 10);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return false;
  }

  const isWeekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday);
  if (!isWeekday) {
    return false;
  }

  if (isNyHoliday(parts)) {
    return false;
  }

  const minutes = hour * 60 + minute;
  const openMinutes = 9 * 60 + 30;
  const closeMinutes = 16 * 60;
  return minutes >= openMinutes && minutes < closeMinutes;
}
