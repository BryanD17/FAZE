import { describe, expect, it } from 'vitest';
import {
  cellLabel,
  cellsToSlots,
  countHours,
  emptyCells,
  setCell,
  slotsToCells,
} from './availabilityGrid.ts';

describe('slotsToCells', () => {
  it('fills one cell per hour of a slot', () => {
    // Maya in the demo data: Monday 18:00–22:00.
    const { cells, rounded } = slotsToCells([
      { dayOfWeek: 1, startLocal: '18:00', endLocal: '22:00' },
    ]);
    expect(cells[1]?.slice(17, 23)).toEqual([false, true, true, true, true, false]);
    expect(countHours(cells)).toBe(4);
    expect(rounded).toBe(false);
  });

  it('runs a slot past midnight into the next day, and Saturday into Sunday', () => {
    const { cells } = slotsToCells([{ dayOfWeek: 6, startLocal: '23:00', endLocal: '01:00' }]);
    expect(cells[6]?.[23]).toBe(true);
    expect(cells[0]?.[0]).toBe(true);
    expect(countHours(cells)).toBe(2);
  });

  it('treats 24:00 as the end of the day', () => {
    const { cells } = slotsToCells([{ dayOfWeek: 2, startLocal: '22:00', endLocal: '24:00' }]);
    expect(countHours(cells)).toBe(2);
    expect(cells[3]?.[0]).toBe(false);
  });

  it('marks half-hour slots as rounded and covers the partial hours', () => {
    const { cells, rounded } = slotsToCells([
      { dayOfWeek: 3, startLocal: '19:30', endLocal: '22:30' },
    ]);
    expect(rounded).toBe(true);
    expect(cells[3]?.slice(19, 23)).toEqual([true, true, true, true]);
  });
});

describe('cellsToSlots', () => {
  it('merges neighbouring hours into one slot', () => {
    let cells = emptyCells();
    for (const h of [18, 19, 20, 21]) cells = setCell(cells, 1, h, true);
    expect(cellsToSlots(cells)).toEqual([{ dayOfWeek: 1, startLocal: '18:00', endLocal: '22:00' }]);
  });

  it('keeps gaps as separate slots and ends the last hour at 24:00', () => {
    let cells = emptyCells();
    for (const h of [9, 10, 23]) cells = setCell(cells, 0, h, true);
    expect(cellsToSlots(cells)).toEqual([
      { dayOfWeek: 0, startLocal: '09:00', endLocal: '11:00' },
      { dayOfWeek: 0, startLocal: '23:00', endLocal: '24:00' },
    ]);
  });

  it('lists Monday first and Sunday last', () => {
    let cells = emptyCells();
    cells = setCell(cells, 0, 10, true);
    cells = setCell(cells, 1, 10, true);
    expect(cellsToSlots(cells).map((s) => s.dayOfWeek)).toEqual([1, 0]);
  });

  it('round-trips the demo evenings unchanged', () => {
    const slots = [1, 2, 3, 4].map((dayOfWeek) => ({
      dayOfWeek,
      startLocal: '18:00',
      endLocal: '22:00',
    }));
    slots.push({ dayOfWeek: 6, startLocal: '14:00', endLocal: '18:00' });
    expect(cellsToSlots(slotsToCells(slots).cells)).toEqual(slots);
  });

  it('returns no slots for an empty grid', () => {
    expect(cellsToSlots(emptyCells())).toEqual([]);
  });
});

describe('setCell and cellLabel', () => {
  it('returns the same object when nothing changes, so React can skip a render', () => {
    const cells = emptyCells();
    expect(setCell(cells, 1, 1, false)).toBe(cells);
    expect(setCell(cells, 1, 1, true)).not.toBe(cells);
  });

  it('labels cells for screen readers', () => {
    expect(cellLabel(1, 18)).toBe('Monday 18:00');
    expect(cellLabel(0, 0)).toBe('Sunday 00:00');
  });
});
