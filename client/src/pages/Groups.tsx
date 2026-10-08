import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CreateGroupForm } from '../components/CreateGroupForm.tsx';
import { inputClass, primaryButtonClass, secondaryButtonClass } from '../components/Field.tsx';
import { GroupCard } from '../components/GroupCard.tsx';
import { messageOf } from '../lib/api.ts';
import type { Game, GroupListReply, LookupItem, Lookups } from '../lib/types.ts';
import { useApi } from '../lib/useApi.ts';

type FilterName = 'gameId' | 'platformId' | 'regionId';

function FilterSelect({
  label,
  name,
  value,
  options,
  onChange,
}: {
  label: string;
  name: FilterName;
  value: string;
  options: LookupItem[];
  onChange: (name: FilterName, value: string) => void;
}) {
  return (
    <label className="flex flex-1 flex-col gap-1.5 text-sm font-medium">
      {label}
      <select className={inputClass} value={value} onChange={(e) => onChange(name, e.target.value)}>
        <option value="">Any</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Groups() {
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const lookups = useApi<Lookups>('/lookups');
  const popular = useApi<Game[]>('/games/popular');
  const list = useApi<GroupListReply>(`/groups?${params}`);

  const page = list.data?.page ?? 1;
  const filterError = lookups.error ?? popular.error;
  const gameOptions = (popular.data ?? []).map((g) => ({ id: g.id, name: g.title }));

  function setFilter(name: FilterName, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    next.delete('page');
    setParams(next);
  }

  function goToPage(target: number) {
    const next = new URLSearchParams(params);
    if (target > 1) next.set('page', String(target));
    else next.delete('page');
    setParams(next);
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-semibold">Groups</h1>
        {!creating && lookups.data && (
          <button type="button" className={primaryButtonClass} onClick={() => setCreating(true)}>
            Create group
          </button>
        )}
      </div>

      {creating && lookups.data && (
        <div className="mb-8">
          <CreateGroupForm lookups={lookups.data} onCancel={() => setCreating(false)} />
        </div>
      )}

      <div className="mb-6 flex flex-col gap-4 sm:flex-row">
        <FilterSelect
          label="Game"
          name="gameId"
          value={params.get('gameId') ?? ''}
          options={gameOptions}
          onChange={setFilter}
        />
        <FilterSelect
          label="Platform"
          name="platformId"
          value={params.get('platformId') ?? ''}
          options={lookups.data?.platforms ?? []}
          onChange={setFilter}
        />
        <FilterSelect
          label="Region"
          name="regionId"
          value={params.get('regionId') ?? ''}
          options={lookups.data?.regions ?? []}
          onChange={setFilter}
        />
      </div>

      {filterError ? <p className="mb-4 text-sm text-danger">{messageOf(filterError)}</p> : null}

      {list.error ? (
        <p className="text-danger">{messageOf(list.error)}</p>
      ) : !list.data ? (
        <p className="text-content-muted">Loading…</p>
      ) : list.data.groups.length === 0 ? (
        <p className="text-content-muted">No groups match these filters yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.data.groups.map((g) => (
            <GroupCard key={g.groupId} group={g} />
          ))}
        </ul>
      )}

      {list.data && (page > 1 || list.data.hasMore) && (
        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={page <= 1}
            onClick={() => goToPage(page - 1)}
          >
            Previous
          </button>
          <span className="text-sm tabular-nums text-content-muted">Page {page}</span>
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={!list.data.hasMore}
            onClick={() => goToPage(page + 1)}
          >
            Next
          </button>
        </div>
      )}
    </main>
  );
}
