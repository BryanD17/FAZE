import { useState, type FormEvent } from 'react';

import { api, messageOf } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import type { GroupMember, PlaySession } from '../lib/types.ts';
import { useApi } from '../lib/useApi.ts';
import { inputClass, primaryButtonClass, secondaryButtonClass } from './Field.tsx';

export function SessionsBox({
  groupId,
  members,
  isOwner,
}: {
  groupId: number;
  members: GroupMember[];
  isOwner: boolean;
}) {
  const { state } = useAuth();
  const sessions = useApi<{ sessions: PlaySession[] }>(`/groups/${groupId}/sessions`);
  const [startsAt, setStartsAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [rated, setRated] = useState<Set<string>>(() => new Set());

  const myUserId = state.status === 'signedIn' ? state.user.userId : null;
  const teammates = members.filter((member) => member.userId !== myUserId);

  async function schedule(event: FormEvent) {
    event.preventDefault();
    if (!startsAt) return;

    const date = new Date(startsAt);
    if (Number.isNaN(date.getTime())) {
      setError('Choose a valid date and time.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await api(`/groups/${groupId}/sessions`, {
        method: 'POST',
        body: { startsAt: date.toISOString() },
      });
      setStartsAt('');
      sessions.reload();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function markPlayed(sessionId: number) {
    setBusy(true);
    setError(null);
    try {
      await api(`/sessions/${sessionId}/played`, { method: 'POST' });
      sessions.reload();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function rate(sessionId: number, rateeUserId: number) {
    const key = `${sessionId}:${rateeUserId}`;
    setBusy(true);
    setError(null);
    try {
      await api(`/sessions/${sessionId}/ratings`, {
        method: 'POST',
        body: { rateeUserId, score: scores[key] ?? 5 },
      });
      setRated((current) => new Set(current).add(key));
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-10">
      <h2 className="mb-3 text-xl font-semibold">Sessions</h2>

      <form onSubmit={schedule} className="mb-4 flex flex-col gap-2 sm:flex-row">
        <input
          aria-label="Session date and time"
          type="datetime-local"
          className={inputClass}
          value={startsAt}
          onChange={(event) => setStartsAt(event.target.value)}
        />
        <button type="submit" className={primaryButtonClass} disabled={busy || !startsAt}>
          Schedule
        </button>
      </form>

      {sessions.error ? (
        <p className="text-sm text-danger">{messageOf(sessions.error)}</p>
      ) : !sessions.data ? (
        <p className="text-sm text-content-muted">Loading…</p>
      ) : sessions.data.sessions.length === 0 ? (
        <p className="text-sm text-content-muted">No sessions scheduled yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {sessions.data.sessions.map((session) => (
            <li
              key={session.sessionId}
              className="rounded-sm border border-subtle bg-surface-raised p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{new Date(session.startsAt).toLocaleString()}</p>
                  <p className="text-sm capitalize text-content-muted">{session.state}</p>
                </div>
                {isOwner && session.state === 'scheduled' && (
                  <button
                    type="button"
                    className={secondaryButtonClass}
                    disabled={busy}
                    onClick={() => void markPlayed(session.sessionId)}
                  >
                    Mark played
                  </button>
                )}
              </div>

              {session.state === 'played' && teammates.length > 0 && (
                <div className="mt-3 border-t border-subtle pt-3">
                  <p className="mb-2 text-sm font-medium">Rate teammates</p>
                  <div className="flex flex-col gap-2">
                    {teammates.map((member) => {
                      const key = `${session.sessionId}:${member.userId}`;
                      return (
                        <div key={member.userId} className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm">{member.displayName}</span>
                          {rated.has(key) ? (
                            <span className="text-sm text-content-muted">Rated</span>
                          ) : (
                            <>
                              <select
                                aria-label={`Rating for ${member.displayName}`}
                                className="rounded-sm border border-subtle bg-surface px-2 py-1 text-sm"
                                value={scores[key] ?? 5}
                                onChange={(event) =>
                                  setScores((current) => ({
                                    ...current,
                                    [key]: Number(event.target.value),
                                  }))
                                }
                              >
                                {[1, 2, 3, 4, 5].map((score) => (
                                  <option key={score} value={score}>
                                    {score}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                className={secondaryButtonClass}
                                disabled={busy}
                                onClick={() => void rate(session.sessionId, member.userId)}
                              >
                                Rate
                              </button>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </section>
  );
}
