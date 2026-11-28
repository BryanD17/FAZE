import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { availabilitySetSchema, displayNameSchema, type LocalAvailabilitySlot } from '@faze/shared';
import {
  Field,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/Field.tsx';
import { AvailabilityGrid } from '../components/AvailabilityGrid.tsx';
import { GameSearch } from '../components/GameSearch.tsx';
import { api, ApiError, messageOf } from '../lib/api.ts';
import { cellsToSlots, slotsToCells, type Cells } from '../lib/availabilityGrid.ts';
import { toggle } from '../lib/list.ts';
import type { Game, Lookups } from '../lib/types.ts';

type Me = {
  displayName: string;
  regionId: number | null;
  timezone: string;
  platforms: string[];
  tags: string[];
};
type Availability = { timezone: string; local: LocalAvailabilitySlot[] };

type Form = {
  displayName: string;
  regionId: string;
  timezone: string;
  platformIds: number[];
  tagIds: number[];
  /** The slots as last loaded or saved; sent back unchanged if the grid was not touched. */
  slots: LocalAvailabilitySlot[];
  cells: Cells;
  /** True once the person changes the grid, so untouched half-hour slots are not rounded. */
  gridChanged: boolean;
  /** True when a saved slot did not start or end on the hour. */
  rounded: boolean;
};

function fromSlots(slots: LocalAvailabilitySlot[]) {
  const { cells, rounded } = slotsToCells(slots);
  return { slots, cells, rounded, gridChanged: false };
}
const TIMEZONES = Intl.supportedValuesOf('timeZone');
const BROWSER_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const MAX_TAGS = 5;
const FIELDS = ['displayName', 'regionId', 'timezone', 'platformIds', 'tagIds', 'availability'];

export function Profile() {
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const [gameError, setGameError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<Lookups>('/lookups'),
      api<Me>('/profile/me'),
      api<Game[]>('/profile/me/games'),
      api<Availability>('/profile/me/availability'),
    ])
      .then(([lookupData, me, myGames, availability]) => {
        if (cancelled) return;
        setLookups(lookupData);
        setGames(myGames);
        setForm({
          displayName: me.displayName,
          regionId: me.regionId === null ? '' : String(me.regionId),
          // New profiles start on UTC; suggest the browser's zone until they save times.
          timezone:
            me.timezone === 'UTC' && availability.local.length === 0
              ? BROWSER_TIMEZONE
              : me.timezone,
          platformIds: lookupData.platforms
            .filter((p) => me.platforms.includes(p.slug))
            .map((p) => p.id),
          tagIds: lookupData.tags.filter((t) => me.tags.includes(t.slug)).map((t) => t.id),
          ...fromSlots(availability.local),
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(messageOf(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadError) {
    return (
      <Shell>
        <p className="text-danger">{loadError}</p>
      </Shell>
    );
  }
  if (!lookups || !form) {
    return (
      <Shell>
        <p className="text-content-muted">Loading…</p>
      </Shell>
    );
  }

  function change(patch: Partial<Form>) {
    setForm((f) => (f ? { ...f, ...patch } : f));
    setSaved(false);
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setErrors({});
    setFormError(null);
    setSaved(false);

    const name = displayNameSchema.safeParse(form.displayName);
    if (!name.success) {
      setErrors({ displayName: name.error.issues[0]?.message ?? 'Invalid display name.' });
      return;
    }
    const slots = availabilitySetSchema.safeParse(
      form.gridChanged ? cellsToSlots(form.cells) : form.slots,
    );
    if (!slots.success) {
      const tooMany = slots.error.issues.some((i) => i.code === 'too_big' && i.path.length === 0);
      setErrors({
        availability: tooMany
          ? 'That is more than 50 separate blocks of time. Join some neighbouring hours together.'
          : (slots.error.issues[0]?.message ?? 'Invalid time.'),
      });
      return;
    }

    setSaving(true);
    try {
      await api('/profile/me', {
        method: 'PATCH',
        body: {
          displayName: name.data,
          regionId: form.regionId ? Number(form.regionId) : null,
          timezone: form.timezone,
        },
      });
      await api('/profile/me/platforms', {
        method: 'PUT',
        body: { platformIds: form.platformIds },
      });
      await api('/profile/me/tags', { method: 'PUT', body: { tagIds: form.tagIds } });
      const availability = await api<Availability>('/profile/me/availability', {
        method: 'PUT',
        body: slots.data,
      });
      change(fromSlots(availability.local));
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError && err.field && FIELDS.includes(err.field)) {
        setErrors({ [err.field]: err.message });
      } else {
        setFormError(messageOf(err));
      }
    } finally {
      setSaving(false);
    }
  }

  async function addGame(gameId: number) {
    setGameError(null);
    try {
      setGames(await api<Game[]>('/profile/me/games', { method: 'POST', body: { gameId } }));
    } catch (err) {
      setGameError(messageOf(err));
    }
  }

  async function removeGame(gameId: number) {
    setGameError(null);
    try {
      await api(`/profile/me/games/${gameId}`, { method: 'DELETE' });
      setGames((list) => list.filter((g) => g.id !== gameId));
    } catch (err) {
      setGameError(messageOf(err));
    }
  }

  return (
    <Shell>
      <form onSubmit={onSave} noValidate className="flex flex-col gap-6">
        <Field label="Display name" htmlFor="displayName" error={errors.displayName}>
          <input
            id="displayName"
            className={inputClass}
            value={form.displayName}
            onChange={(e) => change({ displayName: e.target.value })}
          />
        </Field>

        <Field label="Region" htmlFor="region" error={errors.regionId}>
          <select
            id="region"
            className={inputClass}
            value={form.regionId}
            onChange={(e) => change({ regionId: e.target.value })}
          >
            <option value="">Not set</option>
            {lookups.regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-medium">Platforms</legend>
          <div className="flex flex-wrap gap-4">
            {lookups.platforms.map((p) => (
              <label key={p.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.platformIds.includes(p.id)}
                  onChange={() => change({ platformIds: toggle(form.platformIds, p.id) })}
                />
                {p.name}
              </label>
            ))}
          </div>
          {errors.platformIds && <p className="text-sm text-danger">{errors.platformIds}</p>}
        </fieldset>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-medium">Play style (up to {MAX_TAGS})</legend>
          <div className="flex flex-wrap gap-4">
            {lookups.tags.map((t) => {
              const checked = form.tagIds.includes(t.id);
              return (
                <label key={t.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && form.tagIds.length >= MAX_TAGS}
                    onChange={() => change({ tagIds: toggle(form.tagIds, t.id) })}
                  />
                  {t.name}
                </label>
              );
            })}
          </div>
          {errors.tagIds && <p className="text-sm text-danger">{errors.tagIds}</p>}
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1.5 text-sm font-medium">Weekly availability</legend>
          <Field label="Timezone" htmlFor="timezone" error={errors.timezone}>
            <select
              id="timezone"
              className={inputClass}
              value={form.timezone}
              onChange={(e) => change({ timezone: e.target.value })}
            >
              {!TIMEZONES.includes(form.timezone) && (
                <option value={form.timezone}>{form.timezone}</option>
              )}
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </Field>
          <AvailabilityGrid
            cells={form.cells}
            timezone={form.timezone}
            onChange={(cells) => change({ cells, gridChanged: true })}
          />
          {form.rounded && (
            <p className="text-sm text-content-muted">
              {form.gridChanged
                ? 'Some saved times did not start on the hour. Saving now stores the whole hours shown in the grid.'
                : 'Some saved times do not start on the hour, so the grid shows the whole hour. They stay exactly as saved unless you change the grid.'}
            </p>
          )}
          {errors.availability && <p className="text-sm text-danger">{errors.availability}</p>}
        </fieldset>

        {formError && <p className="text-sm text-danger">{formError}</p>}
        <div className="flex items-center gap-4">
          <button type="submit" disabled={saving} className={primaryButtonClass}>
            {saving ? 'Saving…' : 'Save profile'}
          </button>
          {saved && <p className="text-sm text-success">Saved.</p>}
        </div>
      </form>

      <section className="mt-10 flex flex-col gap-4 border-t border-subtle pt-8">
        <h2 className="text-xl font-semibold">Favourite games</h2>
        <p className="text-sm text-content-muted">Changes here are saved right away.</p>
        {games.length === 0 ? (
          <p className="text-sm text-content-muted">No games added yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {games.map((g) => (
              <li
                key={g.id}
                className="flex items-center justify-between rounded-sm border border-subtle bg-surface-raised px-3 py-2"
              >
                {g.title}
                <button
                  type="button"
                  className={secondaryButtonClass}
                  onClick={() => removeGame(g.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <GameSearch
          onPick={(g) => void addGame(g.id)}
          isPicked={(g) => games.some((mine) => mine.id === g.id)}
          error={gameError}
        />
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-6 text-3xl font-semibold">Your profile</h1>
      {children}
    </main>
  );
}
