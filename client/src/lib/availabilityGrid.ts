import type { LocalAvailabilitySlot } from '@faze/shared';

/**
 * Helpers for the weekly availability grid: 7 days × 24 one-hour cells in the
 * person's own time zone. The server still stores and converts slots; these
 * functions only translate between slots and cells.
 *
 * `cells[day][hour]` uses the API's day numbers (0 = Sunday … 6 = Saturday).
 */
export type Cells = boolean[][];

export const HOURS = 24;
export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
/** The grid shows the week Monday first, as the issue asks. */
export const DISPLAY_DAYS = [1, 2, 3, 4, 5, 6, 0] as const;

export function emptyCells(): Cells {
  return Array.from({ length: 7 }, () => Array.from({ length: HOURS }, () => false));
}

function toMinutes(value: string) {
  if (value === '24:00') return 1440;
  const [h, m] = value.split(':');
  return Number(h) * 60 + Number(m);
}

function hh(hour: number) {
  return hour === 24 ? '24:00' : `${String(hour).padStart(2, '0')}:00`;
}

export function cellLabel(day: number, hour: number) {
  return `${DAY_NAMES[day]} ${hh(hour)}`;
}

/**
 * Turn saved slots into cells. A cell is on when the slot covers any part of
 * that hour. A slot whose end is at or before its start runs past midnight
 * into the next day (Saturday wraps to Sunday).
 *
 * `rounded` is true when some slot does not start and end on the hour, so the
 * grid can say the times were rounded to whole hours.
 */
export function slotsToCells(slots: LocalAvailabilitySlot[]): { cells: Cells; rounded: boolean } {
  const cells = emptyCells();
  let rounded = false;

  for (const slot of slots) {
    const start = toMinutes(slot.startLocal);
    let end = toMinutes(slot.endLocal);
    if (end <= start) end += 1440;
    if (start % 60 !== 0 || end % 60 !== 0) rounded = true;

    const firstHour = Math.floor(start / 60);
    const lastHour = Math.ceil(end / 60); // exclusive
    for (let h = firstHour; h < lastHour; h += 1) {
      const day = (slot.dayOfWeek + Math.floor(h / HOURS)) % 7;
      const row = cells[day];
      if (row) row[h % HOURS] = true;
    }
  }

  return { cells, rounded };
}

/**
 * Turn cells back into slots for `PUT /api/profile/me/availability`: each run
 * of neighbouring "on" hours in a day becomes one slot. A run that reaches the
 * end of the day ends at "24:00"; runs are never joined across midnight, which
 * the server handles fine as two slots.
 */
export function cellsToSlots(cells: Cells): LocalAvailabilitySlot[] {
  const slots: LocalAvailabilitySlot[] = [];

  cells.forEach((row, day) => {
    let runStart: number | null = null;
    for (let h = 0; h <= HOURS; h += 1) {
      const on = h < HOURS && row[h] === true;
      if (on && runStart === null) runStart = h;
      if (!on && runStart !== null) {
        slots.push({ dayOfWeek: day, startLocal: hh(runStart), endLocal: hh(h) });
        runStart = null;
      }
    }
  });

  // Monday first, to match the grid, so error messages point at the right row.
  return slots.sort(
    (a, b) =>
      DISPLAY_DAYS.indexOf(a.dayOfWeek as (typeof DISPLAY_DAYS)[number]) -
        DISPLAY_DAYS.indexOf(b.dayOfWeek as (typeof DISPLAY_DAYS)[number]) ||
      a.startLocal.localeCompare(b.startLocal),
  );
}

/** Return a copy of `cells` with one cell set to `value`. */
export function setCell(cells: Cells, day: number, hour: number, value: boolean): Cells {
  if (cells[day]?.[hour] === value) return cells;
  return cells.map((row, d) => (d === day ? row.map((v, h) => (h === hour ? value : v)) : row));
}

export function countHours(cells: Cells) {
  return cells.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
}
