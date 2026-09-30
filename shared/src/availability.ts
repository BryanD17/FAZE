import type { LocalAvailabilitySlot } from './schemas/profile.js';

export interface UtcAvailabilitySlot {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

const MINUTE = 60_000;
const DAY = 86_400_000;

function formatter(timeZone: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

function parts(date: Date, timeZone: string) {
  const values = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(date)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value]),
  );

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function addDays(date: CalendarDate, amount: number): CalendarDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + amount));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

function localWeekday(date: CalendarDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

function localDateOf(date: Date, timeZone: string): CalendarDate {
  const p = parts(date, timeZone);
  return { year: p.year, month: p.month, day: p.day };
}

function sundayOfLocalWeek(reference: Date, timeZone: string): CalendarDate {
  const local = localDateOf(reference, timeZone);
  return addDays(local, -localWeekday(local));
}

function zonedLocalToInstant(
  date: CalendarDate,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const target = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  let guess = target;

  for (let i = 0; i < 5; i += 1) {
    const shown = parts(new Date(guess), timeZone);
    const shownAsUtc = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute);

    const difference = target - shownAsUtc;
    if (difference === 0) break;
    guess += difference;
  }

  const result = new Date(guess);
  const check = parts(result, timeZone);

  if (
    check.year !== date.year ||
    check.month !== date.month ||
    check.day !== date.day ||
    check.hour !== hour ||
    check.minute !== minute
  ) {
    throw new Error(
      `Local time ${date.year}-${date.month}-${date.day} ${hour}:${minute} does not exist in ${timeZone}.`,
    );
  }

  return result;
}

function parseTime(value: string): number {
  if (value === '24:00') return 1440;
  const [hourText, minuteText] = value.split(':');
  return Number(hourText) * 60 + Number(minuteText);
}

function formatTime(minutes: number): string {
  if (minutes === 1440) return '24:00';
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function minuteOfUtcDay(date: Date): number {
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

export function mergeUtcAvailability(input: UtcAvailabilitySlot[]): UtcAvailabilitySlot[] {
  const sorted = [...input].sort(
    (a, b) =>
      a.dayOfWeek - b.dayOfWeek || a.startMinute - b.startMinute || a.endMinute - b.endMinute,
  );

  const merged: UtcAvailabilitySlot[] = [];

  for (const slot of sorted) {
    const previous = merged[merged.length - 1];

    if (
      previous &&
      previous.dayOfWeek === slot.dayOfWeek &&
      slot.startMinute <= previous.endMinute
    ) {
      previous.endMinute = Math.max(previous.endMinute, slot.endMinute);
    } else {
      merged.push({ ...slot });
    }
  }

  return merged;
}

export function localAvailabilityToUtc(
  slots: LocalAvailabilitySlot[],
  timeZone: string,
  referenceDate = new Date(),
): UtcAvailabilitySlot[] {
  const sunday = sundayOfLocalWeek(referenceDate, timeZone);
  const output: UtcAvailabilitySlot[] = [];

  for (const slot of slots) {
    const startMinutes = parseTime(slot.startLocal);
    const endMinutes = parseTime(slot.endLocal);

    const startDate = addDays(sunday, slot.dayOfWeek);

    const start = zonedLocalToInstant(
      startDate,
      Math.floor(startMinutes / 60),
      startMinutes % 60,
      timeZone,
    );

    let endDate = startDate;
    let normalizedEnd = endMinutes;

    if (endMinutes === 1440) {
      endDate = addDays(startDate, 1);
      normalizedEnd = 0;
    } else if (endMinutes <= startMinutes) {
      endDate = addDays(startDate, 1);
    }

    const end = zonedLocalToInstant(
      endDate,
      Math.floor(normalizedEnd / 60),
      normalizedEnd % 60,
      timeZone,
    );

    let cursor = new Date(start);

    while (cursor < end) {
      const nextMidnight = new Date(
        Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() + 1),
      );

      const pieceEnd = nextMidnight < end ? nextMidnight : end;

      output.push({
        dayOfWeek: cursor.getUTCDay(),
        startMinute: minuteOfUtcDay(cursor),
        endMinute:
          pieceEnd.getUTCDate() !== cursor.getUTCDate() ||
          pieceEnd.getUTCMonth() !== cursor.getUTCMonth()
            ? 1440
            : minuteOfUtcDay(pieceEnd),
      });

      cursor = pieceEnd;
    }
  }

  return mergeUtcAvailability(output);
}

interface AbsoluteInterval {
  start: Date;
  end: Date;
}

function mergeAbsolute(input: AbsoluteInterval[]): AbsoluteInterval[] {
  const sorted = [...input].sort((a, b) => a.start.getTime() - b.start.getTime());

  const merged: AbsoluteInterval[] = [];

  for (const interval of sorted) {
    const previous = merged[merged.length - 1];

    if (previous && interval.start.getTime() <= previous.end.getTime()) {
      if (interval.end > previous.end) previous.end = interval.end;
    } else {
      merged.push({
        start: new Date(interval.start),
        end: new Date(interval.end),
      });
    }
  }

  return merged;
}

function localMinute(date: Date, timeZone: string): number {
  const p = parts(date, timeZone);
  return p.hour * 60 + p.minute;
}

export function utcAvailabilityToLocal(
  slots: UtcAvailabilitySlot[],
  timeZone: string,
  referenceDate = new Date(),
): LocalAvailabilitySlot[] {
  const localSunday = sundayOfLocalWeek(referenceDate, timeZone);
  const localWeekStart = zonedLocalToInstant(localSunday, 0, 0, timeZone);
  const localWeekEnd = zonedLocalToInstant(addDays(localSunday, 7), 0, 0, timeZone);

  const utcDate = new Date(
    Date.UTC(
      localWeekStart.getUTCFullYear(),
      localWeekStart.getUTCMonth(),
      localWeekStart.getUTCDate(),
    ),
  );

  const utcSunday = new Date(utcDate.getTime() - utcDate.getUTCDay() * DAY);

  const candidates: AbsoluteInterval[] = [];

  for (const slot of slots) {
    for (const weekOffset of [-1, 0, 1]) {
      const dayStart = utcSunday.getTime() + weekOffset * 7 * DAY + slot.dayOfWeek * DAY;

      const start = new Date(dayStart + slot.startMinute * MINUTE);
      const end = new Date(dayStart + slot.endMinute * MINUTE);

      if (
        end > new Date(localWeekStart.getTime() - DAY) &&
        start < new Date(localWeekEnd.getTime() + DAY)
      ) {
        candidates.push({ start, end });
      }
    }
  }

  return mergeAbsolute(candidates)
    .filter((interval) => {
      const d = localDateOf(interval.start, timeZone);
      const fake = Date.UTC(d.year, d.month - 1, d.day);
      const weekStartFake = Date.UTC(localSunday.year, localSunday.month - 1, localSunday.day);
      return fake >= weekStartFake && fake < weekStartFake + 7 * DAY;
    })
    .map((interval) => {
      const startParts = parts(interval.start, timeZone);
      const endParts = parts(interval.end, timeZone);

      const startDate = {
        year: startParts.year,
        month: startParts.month,
        day: startParts.day,
      };

      const endDate = {
        year: endParts.year,
        month: endParts.month,
        day: endParts.day,
      };

      const startMinutes = localMinute(interval.start, timeZone);
      let endMinutes = localMinute(interval.end, timeZone);

      const startFake = Date.UTC(startDate.year, startDate.month - 1, startDate.day);
      const endFake = Date.UTC(endDate.year, endDate.month - 1, endDate.day);

      if (endFake > startFake && endMinutes === 0) {
        endMinutes = 1440;
      }

      return {
        dayOfWeek: localWeekday(startDate),
        startLocal: formatTime(startMinutes),
        endLocal: formatTime(endMinutes),
      };
    });
}

export function summarizeAvailability(slots: LocalAvailabilitySlot[]): string[] {
  const labels = new Set<string>();

  for (const slot of slots) {
    const start = parseTime(slot.startLocal);
    const end = parseTime(slot.endLocal);

    if (slot.dayOfWeek === 0 || slot.dayOfWeek === 6) {
      labels.add('weekends');
    }

    if (start >= 17 * 60 || end >= 17 * 60 || end < start) {
      labels.add('evenings');
    }
  }

  if (labels.size === 0 && slots.length > 0) labels.add('other');

  return [...labels];
}
