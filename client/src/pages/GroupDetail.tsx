import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChatBox } from '../components/ChatBox.tsx';
import { primaryButtonClass, secondaryButtonClass } from '../components/Field.tsx';
import { GameInitial, memberCountLabel } from '../components/GroupCard.tsx';
import { api, ApiError, messageOf } from '../lib/api.ts';
import type { GroupDetail as GroupDetailData, LeaveResult } from '../lib/types.ts';
import { useApi } from '../lib/useApi.ts';

function NotFound() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="mb-2 text-3xl font-semibold">Group not found</h1>
      <p className="text-content-muted">
        It may have been closed after everyone left.{' '}
        <Link to="/groups" className="text-accent hover:text-accent-hover">
          Back to groups
        </Link>
      </p>
    </main>
  );
}

export function GroupDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: group, error, reload } = useApi<GroupDetailData>(`/groups/${id}`);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
    return <NotFound />;
  }
  if (error) {
    return <p className="p-10 text-danger">{messageOf(error)}</p>;
  }
  if (!group) return <p className="p-10 text-content-muted">Loading…</p>;

  const isMember = group.myRole !== null;
  const isFull = group.openSlots === 0;

  async function act(action: 'join' | 'leave') {
    setBusy(true);
    setActionError(null);
    try {
      const { result } = await api<{ result: 'JOINED' | LeaveResult }>(`/groups/${id}/${action}`, {
        method: 'POST',
      });
      if (result === 'LEFT_GROUP_ARCHIVED') {
        navigate('/groups', { replace: true });
        return;
      }
    } catch (err) {
      setActionError(messageOf(err));
    } finally {
      setBusy(false);
    }
    reload();
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link to="/groups" className="text-sm text-accent hover:text-accent-hover">
        ← All groups
      </Link>

      <div className="mt-4 flex gap-4">
        <GameInitial title={group.gameTitle} size="h-20 w-20" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm text-content-muted">{group.gameTitle}</p>
          <h1 className="text-3xl font-semibold">{group.title}</h1>
          <p className="text-sm text-content-muted">
            {group.regionName} · {group.languageCode} ·{' '}
            <span className="tabular-nums">{memberCountLabel(group)}</span> members
          </p>
        </div>
      </div>

      {group.description && <p className="mt-6 whitespace-pre-line">{group.description}</p>}

      <div className="mt-6 flex items-center gap-4">
        {isMember ? (
          <button
            type="button"
            disabled={busy}
            className={secondaryButtonClass}
            onClick={() => void act('leave')}
          >
            {busy ? 'Leaving…' : 'Leave group'}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || isFull}
            className={primaryButtonClass}
            onClick={() => void act('join')}
          >
            {isFull ? 'Group full' : busy ? 'Joining…' : 'Join group'}
          </button>
        )}
        {actionError && <p className="text-sm text-danger">{actionError}</p>}
      </div>

      <section className="mt-10">
        <h2 className="mb-3 text-xl font-semibold">Members</h2>
        <ul className="flex flex-col gap-2">
          {group.members.map((m) => (
            <li
              key={m.displayName}
              className="flex items-center justify-between rounded-sm border border-subtle bg-surface-raised px-3 py-2"
            >
              <span>
                {m.displayName}
                {m.role !== 'member' && (
                  <span className="ml-2 text-sm text-content-muted">({m.role})</span>
                )}
              </span>
              <span className="text-sm text-content-muted">
                Joined {new Date(m.joinedAt).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {isMember && <ChatBox groupId={group.groupId} />}
    </main>
  );
}
