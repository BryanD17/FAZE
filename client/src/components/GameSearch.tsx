import { useState, type KeyboardEvent } from 'react';
import { api, messageOf } from '../lib/api.ts';
import type { Game } from '../lib/types.ts';
import { inputClass, secondaryButtonClass } from './Field.tsx';

const RESULT_LIMIT = 10;

export function GameSearch({
  onPick,
  isPicked,
  pickLabel = 'Add',
  pickedLabel = 'Added',
  multiplayerOnly = false,
  error,
}: {
  onPick: (game: Game) => void;
  isPicked: (game: Game) => boolean;
  pickLabel?: string;
  pickedLabel?: string;
  multiplayerOnly?: boolean;
  error?: string | null;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Game[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  async function search() {
    const q = query.trim();
    if (!q) return;
    setSearchError(null);
    const params = new URLSearchParams({ q, limit: String(RESULT_LIMIT) });
    if (multiplayerOnly) params.set('multiplayerOnly', 'true');
    try {
      setResults((await api<{ data: Game[] }>(`/games/search?${params}`)).data);
    } catch (err) {
      setSearchError(messageOf(err));
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void search();
  }

  const shownError = searchError ?? error;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <input
          aria-label="Search games"
          placeholder="Search games, e.g. Counter-Strike"
          className={inputClass}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="button" className={secondaryButtonClass} onClick={() => void search()}>
          Search
        </button>
      </div>
      {shownError && <p className="text-sm text-danger">{shownError}</p>}
      {results && results.length === 0 && (
        <p className="text-sm text-content-muted">No games found.</p>
      )}
      {results && results.length > 0 && (
        <ul className="flex flex-col gap-2">
          {results.map((g) => {
            const picked = isPicked(g);
            return (
              <li key={g.id} className="flex items-center justify-between px-3 py-1">
                {g.title}
                <button
                  type="button"
                  disabled={picked}
                  className={secondaryButtonClass}
                  onClick={() => onPick(g)}
                >
                  {picked ? pickedLabel : pickLabel}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
