import { Link } from 'react-router-dom';
import { GroupCard } from '../components/GroupCard.tsx';
import { messageOf } from '../lib/api.ts';
import type { MatchCard } from '../lib/types.ts';
import { useApi } from '../lib/useApi.ts';

function formatHours(hours: number) {
  return hours < 0.1 ? 'under 0.1' : String(Math.round(hours * 10) / 10);
}

export function matchReason(match: Pick<MatchCard, 'sameGame' | 'sameRegion' | 'overlapHours'>) {
  const parts: string[] = [];
  if (match.sameGame) parts.push('same game');
  if (match.sameRegion) parts.push('same region');
  if (match.overlapHours > 0) parts.push(`${formatHours(match.overlapHours)} h in common`);
  const reason = parts.join(', ');
  return reason.charAt(0).toUpperCase() + reason.slice(1);
}

export function Matches() {
  const { data, error } = useApi<{ matches: MatchCard[] }>('/matches');

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="mb-2 text-3xl font-semibold">Matches</h1>
      <p className="mb-6 text-content-muted">Open groups ranked for you, best first.</p>

      {error ? (
        <p className="text-danger">{messageOf(error)}</p>
      ) : !data ? (
        <p className="text-content-muted">Loading…</p>
      ) : data.matches.length === 0 ? (
        <p className="text-content-muted">
          No matches yet. Add games, a region and weekly times on your{' '}
          <Link to="/profile" className="text-accent hover:text-accent-hover">
            profile
          </Link>
          .
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.matches.map((m) => (
            <GroupCard key={m.groupId} group={m}>
              <p className="text-sm">
                <span className="font-semibold tabular-nums text-accent">{m.score} / 100</span>
                <span className="text-content-muted"> · {matchReason(m)}</span>
              </p>
            </GroupCard>
          ))}
        </ul>
      )}
    </main>
  );
}
