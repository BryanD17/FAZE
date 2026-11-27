import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  cellLabel,
  countHours,
  DAY_NAMES,
  DISPLAY_DAYS,
  HOURS,
  setCell,
  type Cells,
} from '../lib/availabilityGrid.ts';

const HOUR_LIST = Array.from({ length: HOURS }, (_, h) => h);

type Focus = { col: number; hour: number };

/**
 * A Monday-to-Sunday grid, one cell per hour, in the person's own time zone.
 *
 * - Click a cell to turn it on or off; press and drag to paint several (the
 *   first cell decides whether the drag paints "on" or "off").
 * - Keyboard: Tab into the grid, arrow keys move, Space or Enter toggles.
 *   Only one cell is in the tab order at a time (a "roving" tab index).
 * - On a phone the grid scrolls inside its own box, not the whole page.
 */
export function AvailabilityGrid({
  cells,
  onChange,
  timezone,
}: {
  cells: Cells;
  onChange: (cells: Cells) => void;
  timezone: string;
}) {
  const [focus, setFocus] = useState<Focus>({ col: 0, hour: 18 });
  const paint = useRef<boolean | null>(null);
  // Set when a mouse press already toggled the cell, so the click after it is ignored.
  const pressed = useRef(false);
  // Keep the newest cells for pointer events that fire between renders.
  const latest = useRef(cells);
  latest.current = cells;
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  // A drag that ends outside the grid still has to stop painting.
  useEffect(() => {
    const stop = () => {
      paint.current = null;
      // A drag that ends on another cell gets no click, so clear the flag
      // after any click from this press has had its turn.
      setTimeout(() => {
        pressed.current = false;
      }, 0);
    };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, []);

  function apply(day: number, hour: number, value: boolean) {
    const next = setCell(latest.current, day, hour, value);
    if (next !== latest.current) {
      latest.current = next;
      onChange(next);
    }
  }

  function toggle(col: number, hour: number) {
    const day = DISPLAY_DAYS[col] ?? 0;
    apply(day, hour, !latest.current[day]?.[hour]);
  }

  // Mouse and pen paint from the moment the button goes down. Touch is left to
  // the click below, so swiping to scroll the grid on a phone changes nothing.
  function onPointerDown(event: PointerEvent<HTMLButtonElement>, col: number, hour: number) {
    if (event.button !== 0 || event.pointerType === 'touch') return;
    event.preventDefault(); // no text selection while dragging
    event.currentTarget.focus();
    const day = DISPLAY_DAYS[col] ?? 0;
    const value = !latest.current[day]?.[hour];
    paint.current = value;
    pressed.current = true;
    apply(day, hour, value);
  }

  // Taps, Space, Enter and screen-reader activation all arrive as a click.
  function onClick(col: number, hour: number) {
    if (pressed.current) {
      pressed.current = false;
      return;
    }
    toggle(col, hour);
  }

  function onPointerEnter(event: PointerEvent<HTMLButtonElement>, col: number, hour: number) {
    if (paint.current === null) return;
    // The button was released outside the window, so this is not a drag any more.
    if (event.buttons === 0) {
      paint.current = null;
      return;
    }
    apply(DISPLAY_DAYS[col] ?? 0, hour, paint.current);
  }

  function moveFocus(next: Focus) {
    const col = Math.min(6, Math.max(0, next.col));
    const hour = Math.min(HOURS - 1, Math.max(0, next.hour));
    setFocus({ col, hour });
    buttons.current.get(`${col}:${hour}`)?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, col: number, hour: number) {
    const moves: Record<string, Focus> = {
      ArrowLeft: { col: col - 1, hour },
      ArrowRight: { col: col + 1, hour },
      ArrowUp: { col, hour: hour - 1 },
      ArrowDown: { col, hour: hour + 1 },
      Home: { col, hour: 0 },
      End: { col, hour: HOURS - 1 },
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      moveFocus(move);
    }
  }

  const total = countHours(cells);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-content-muted">
        Times are in <span className="text-content-primary">{timezone}</span>. Click (or drag with a
        mouse) to mark the hours you can play; arrow keys and Space work too.{' '}
        <span className="tabular-nums">
          {total} {total === 1 ? 'hour' : 'hours'} a week selected.
        </span>
      </p>
      <div className="max-h-[28rem] overflow-auto rounded-sm border border-subtle bg-surface-raised">
        <table
          role="grid"
          aria-label="Weekly availability"
          className="w-full min-w-[34rem] border-separate border-spacing-0.5 select-none text-xs"
        >
          <thead className="sticky top-0 z-10 bg-surface-raised">
            <tr>
              <th scope="col" className="w-12 px-1 py-1.5 text-left font-medium">
                <span className="sr-only">Hour</span>
              </th>
              {DISPLAY_DAYS.map((day) => (
                <th key={day} scope="col" className="px-1 py-1.5 font-medium">
                  <span aria-hidden>{DAY_NAMES[day].slice(0, 3)}</span>
                  <span className="sr-only">{DAY_NAMES[day]}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {HOUR_LIST.map((hour) => (
              <tr key={hour}>
                <th
                  scope="row"
                  className="px-1 text-left font-normal tabular-nums text-content-muted"
                >
                  {String(hour).padStart(2, '0')}:00
                </th>
                {DISPLAY_DAYS.map((day, col) => {
                  const on = cells[day]?.[hour] === true;
                  const focused = focus.col === col && focus.hour === hour;
                  return (
                    <td key={day} role="gridcell" className="p-0">
                      <button
                        type="button"
                        ref={(el) => {
                          const key = `${col}:${hour}`;
                          if (el) buttons.current.set(key, el);
                          else buttons.current.delete(key);
                        }}
                        tabIndex={focused ? 0 : -1}
                        aria-pressed={on}
                        aria-label={cellLabel(day, hour)}
                        onPointerDown={(e) => onPointerDown(e, col, hour)}
                        onPointerEnter={(e) => onPointerEnter(e, col, hour)}
                        onClick={() => onClick(col, hour)}
                        onKeyDown={(e) => onKeyDown(e, col, hour)}
                        onFocus={() => setFocus({ col, hour })}
                        className={`block h-7 w-full rounded-sm border ${
                          on
                            ? 'border-accent bg-accent'
                            : 'border-subtle bg-surface hover:bg-surface-overlay'
                        }`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
