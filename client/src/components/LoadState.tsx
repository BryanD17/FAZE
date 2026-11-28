import type { ReactNode } from 'react';
import { messageOf } from '../lib/api.ts';
import { secondaryButtonClass } from './Field.tsx';

/**
 * The three non-happy states every page shows the same way: loading, empty
 * and error. Keeping them in one place means the wording and the "Try again"
 * button look identical on every screen.
 */

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p role="status" aria-live="polite" className="text-content-muted">
      {label}
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-content-muted">{children}</p>;
}

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-sm border border-danger/40 bg-surface-raised p-3"
    >
      <p className="text-sm text-danger">{messageOf(error)}</p>
      {onRetry && (
        <button type="button" className={secondaryButtonClass} onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
