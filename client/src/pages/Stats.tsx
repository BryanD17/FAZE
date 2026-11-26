import { messageOf } from '../lib/api.ts';
import { useApi } from '../lib/useApi.ts';

type Summary = {
  totals: {
    users: number;
    games: number;
    groups: number;
    activeMembers: number;
    messages: number;
  };
  memberCountDrift: number;
  popularGames: {
    gameId: number;
    title: string;
    activeGroups: number;
    searchingUsers: number;
  }[];
};

const labels: { key: keyof Summary['totals']; label: string }[] = [
  { key: 'users', label: 'Users' },
  { key: 'games', label: 'Games' },
  { key: 'groups', label: 'Groups' },
  { key: 'activeMembers', label: 'Active members' },
  { key: 'messages', label: 'Messages' },
];

export function Stats() {
  const { data, error } = useApi<Summary>('/reports/summary');

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="mb-2 text-3xl font-semibold">Database stats</h1>
      <p className="mb-6 text-content-muted">A live snapshot from the FAZE database.</p>

      {error ? (
        <p className="text-danger">{messageOf(error)}</p>
      ) : !data ? (
        <p className="text-content-muted">Loading…</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {labels.map(({ key, label }) => (
              <div key={key} className="rounded-sm border border-subtle bg-surface-raised p-4">
                <p className="text-sm text-content-muted">{label}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {data.totals[key].toLocaleString()}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-sm border border-subtle bg-surface-raised p-4">
            <p className="font-medium">
              Member count drift: {data.memberCountDrift}{' '}
              {data.memberCountDrift === 0 ? '(correct)' : '(needs attention)'}
            </p>
            <p className="mt-1 text-sm text-content-muted">
              This compares each stored group member count with the real active membership rows.
            </p>
          </div>

          <section className="mt-8">
            <h2 className="mb-3 text-xl font-semibold">Popular games</h2>
            <div className="overflow-x-auto rounded-sm border border-subtle">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-raised text-content-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Game</th>
                    <th className="px-3 py-2 text-right font-medium">Active groups</th>
                    <th className="px-3 py-2 text-right font-medium">Searching users</th>
                  </tr>
                </thead>
                <tbody>
                  {data.popularGames.map((game) => (
                    <tr key={game.gameId} className="border-t border-subtle">
                      <td className="px-3 py-2">{game.title}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{game.activeGroups}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{game.searchingUsers}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
