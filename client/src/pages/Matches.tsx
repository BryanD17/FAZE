import { Link } from 'react-router-dom';
import { GroupCard } from '../components/GroupCard.tsx';
import { Empty, ErrorNotice, Loading } from '../components/LoadState.tsx';
import { SCORE_MAX, scoreParts } from '../lib/score.ts';
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

const PARTS = [
  { key: 'game', label: 'Game', bar: 'bg-accent' },
  { key: 'region', label: 'Region', bar: 'bg-success' },
  { key: 'freeTime', label: 'Free time', bar: 'bg-warn' },
] as const;

/**
 * One bar split into the three parts of the score. Each part also has a text
 * label, so colour is never the only way to read it.
 */
export function ScoreBreakdown({ match }: { match: MatchCard }) {
  const parts = scoreParts(match);
  return (
    <div className="mt-1 flex flex-col gap-1.5">
      <div aria-hidden className="flex h-2 w-full overflow-hidden rounded-sm bg-surface-overlay">
        {PARTS.map(({ key, bar }) => (
          <div key={key} className={bar} style={{ width: `${parts[key]}%` }} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-content-muted">
        {PARTS.map(({ key, label, bar }) => (
          <li key={key} className="flex items-center gap-1.5">
            <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${bar}`} />
            <span className="tabular-nums">
              {label} {parts[key]} / {SCORE_MAX[key]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Matches() {
  const { data, error, reload } = useApi<{ matches: MatchCard[] }>('/matches');

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="mb-2 text-3xl font-semibold">Matches</h1>
      <p className="mb-6 text-content-muted">Open groups ranked for you, best first.</p>

      {error ? (
        <ErrorNotice error={error} onRetry={reload} />
      ) : !data ? (
        <Loading label="Finding your matches…" />
      ) : data.matches.length === 0 ? (
        <Empty>
          No matches yet. Add a game, a region and weekly times on your{' '}
          <Link to="/profile" className="text-accent hover:text-accent-hover">
            profile
          </Link>
          .
        </Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.matches.map((m) => (
            <GroupCard key={m.groupId} group={m}>
              <p className="text-sm">
                <span className="font-semibold tabular-nums text-accent">{m.score} / 100</span>
                <span className="text-content-muted"> · {matchReason(m)}</span>
              </p>
              <ScoreBreakdown match={m} />
            </GroupCard>
          ))}
        </ul>
      )}
    </main>
  );
}
