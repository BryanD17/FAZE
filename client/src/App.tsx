import { useEffect, useState } from 'react';
import { healthResponseSchema, type HealthResponse } from '@faze/shared';

/**
 * Scaffold shell. AGENT 10 replaces this with the real app shell, design
 * system and router; for now it proves the client/server/shared wiring is
 * live by rendering the actual /api/health response.
 *
 * Note the four states (rule R8) are present even here: loading, error,
 * loaded, and the "down" case. A screen with only a happy path is not done.
 */
type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; health: HealthResponse };

export function App() {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/health', { signal: controller.signal })
      .then(async (res) => healthResponseSchema.parse(await res.json()))
      .then((health) => setState({ status: 'loaded', health }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      });
    return () => controller.abort();
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-4">
      <h1 className="text-4xl font-semibold tracking-tight">FAZE</h1>
      <p className="text-content-muted">
        Gaming group finder — CS 514 Database Theory and Implementation, Fall 2026.
      </p>

      <section
        aria-live="polite"
        className="rounded border border-subtle bg-surface-raised p-4 shadow-raised"
      >
        {state.status === 'loading' && <p className="text-content-muted">Checking API health…</p>}
        {state.status === 'error' && (
          <p className="text-danger">API unreachable: {state.message}</p>
        )}
        {state.status === 'loaded' && (
          <p className={state.health.db === 'up' ? 'text-success' : 'text-warn'}>
            API ok: {String(state.health.ok)} · database: {state.health.db}
          </p>
        )}
      </section>
    </main>
  );
}
