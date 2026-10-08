import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { createGroupSchema, GROUP_MAX_MEMBERS, GROUP_MIN_MEMBERS } from '@faze/shared';
import { api, ApiError, messageOf } from '../lib/api.ts';
import { toggle } from '../lib/list.ts';
import type { Game, GroupDetail, Lookups } from '../lib/types.ts';
import {
  Field,
  fieldErrors,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from './Field.tsx';
import { GameSearch } from './GameSearch.tsx';

const MEMBER_OPTIONS = Array.from(
  { length: GROUP_MAX_MEMBERS - GROUP_MIN_MEMBERS + 1 },
  (_, i) => GROUP_MIN_MEMBERS + i,
);

type Form = {
  game: Game | null;
  title: string;
  description: string;
  regionId: string;
  languageId: string;
  maxMembers: string;
  platformIds: number[];
};

const EMPTY_FORM: Form = {
  game: null,
  title: '',
  description: '',
  regionId: '',
  languageId: '',
  maxMembers: '5',
  platformIds: [],
};

function idOrUndefined(value: string) {
  return value === '' ? undefined : Number(value);
}

export function CreateGroupForm({ lookups, onCancel }: { lookups: Lookups; onCancel: () => void }) {
  const navigate = useNavigate();
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function change(patch: Partial<Form>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const parsed = createGroupSchema.safeParse({
      gameId: form.game?.id,
      title: form.title,
      description: form.description.trim() === '' ? null : form.description,
      regionId: idOrUndefined(form.regionId),
      languageId: idOrUndefined(form.languageId),
      maxMembers: Number(form.maxMembers),
      platformIds: form.platformIds,
    });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      const group = await api<GroupDetail>('/groups', { method: 'POST', body: parsed.data });
      navigate(`/groups/${group.groupId}`);
    } catch (err) {
      if (err instanceof ApiError && err.field) setErrors({ [err.field]: err.message });
      else setFormError(messageOf(err));
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-4 rounded border border-subtle bg-surface-raised p-5"
    >
      <h2 className="text-xl font-semibold">Create a group</h2>

      <Field label="Game" error={errors.gameId}>
        {form.game ? (
          <div className="flex items-center justify-between rounded-sm border border-subtle px-3 py-2">
            {form.game.title}
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={() => change({ game: null })}
            >
              Change
            </button>
          </div>
        ) : (
          <GameSearch
            multiplayerOnly
            pickLabel="Choose"
            onPick={(game) => change({ game })}
            isPicked={() => false}
          />
        )}
      </Field>

      <Field label="Title" htmlFor="title" error={errors.title}>
        <input
          id="title"
          className={inputClass}
          value={form.title}
          onChange={(e) => change({ title: e.target.value })}
        />
      </Field>

      <Field label="Description (optional)" htmlFor="description" error={errors.description}>
        <textarea
          id="description"
          rows={3}
          className={inputClass}
          value={form.description}
          onChange={(e) => change({ description: e.target.value })}
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Region" htmlFor="create-region" error={errors.regionId}>
          <select
            id="create-region"
            className={inputClass}
            value={form.regionId}
            onChange={(e) => change({ regionId: e.target.value })}
          >
            <option value="">Choose…</option>
            {lookups.regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Language" htmlFor="create-language" error={errors.languageId}>
          <select
            id="create-language"
            className={inputClass}
            value={form.languageId}
            onChange={(e) => change({ languageId: e.target.value })}
          >
            <option value="">Choose…</option>
            {lookups.languages.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Max members" htmlFor="create-max" error={errors.maxMembers}>
          <select
            id="create-max"
            className={inputClass}
            value={form.maxMembers}
            onChange={(e) => change({ maxMembers: e.target.value })}
          >
            {MEMBER_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
      </div>

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

      {formError && <p className="text-sm text-danger">{formError}</p>}
      <div className="flex items-center gap-4">
        <button type="submit" disabled={submitting} className={primaryButtonClass}>
          {submitting ? 'Creating…' : 'Create group'}
        </button>
        <button type="button" className={secondaryButtonClass} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
