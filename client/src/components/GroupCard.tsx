import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { GroupCard as GroupCardData } from '../lib/types.ts';

export function GameInitial({ title, size = 'h-14 w-14' }: { title: string; size?: string }) {
  return (
    <div
      aria-hidden
      className={`${size} flex shrink-0 items-center justify-center rounded-sm bg-surface-overlay text-2xl font-semibold text-content-muted`}
    >
      {title.trim().charAt(0).toUpperCase() || '?'}
    </div>
  );
}

export function memberCountLabel(group: Pick<GroupCardData, 'memberCount' | 'maxMembers'>) {
  return `${group.memberCount} / ${group.maxMembers}`;
}

export function GroupCard({ group, children }: { group: GroupCardData; children?: ReactNode }) {
  return (
    <li>
      <Link
        to={`/groups/${group.groupId}`}
        className="flex gap-4 rounded border border-subtle bg-surface-raised p-4 hover:bg-surface-overlay"
      >
        <GameInitial title={group.gameTitle} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="truncate text-sm text-content-muted">{group.gameTitle}</p>
          <p className="truncate text-lg font-semibold">{group.title}</p>
          <p className="text-sm text-content-muted">
            {group.regionCode} · <span className="tabular-nums">{memberCountLabel(group)}</span>{' '}
            members
          </p>
          {children}
        </div>
      </Link>
    </li>
  );
}
