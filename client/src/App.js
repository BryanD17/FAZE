import { jsx as _jsx, jsxs as _jsxs } from 'react/jsx-runtime';
import { useEffect, useState } from 'react';
import { healthResponseSchema } from '@faze/shared';
export function App() {
  const [state, setState] = useState({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/health', { signal: controller.signal })
      .then(async (res) => healthResponseSchema.parse(await res.json()))
      .then((health) => setState({ status: 'loaded', health }))
      .catch((err) => {
        if (controller.signal.aborted) return;
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      });
    return () => controller.abort();
  }, []);
  return _jsxs('main', {
    className: 'mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-4',
    children: [
      _jsx('h1', { className: 'text-4xl font-semibold tracking-tight', children: 'FAZE' }),
      _jsx('p', {
        className: 'text-content-muted',
        children:
          'Gaming group finder \u2014 CS 514 Database Theory and Implementation, Fall 2026.',
      }),
      _jsxs('section', {
        'aria-live': 'polite',
        className: 'rounded border border-subtle bg-surface-raised p-4 shadow-raised',
        children: [
          state.status === 'loading' &&
            _jsx('p', { className: 'text-content-muted', children: 'Checking API health\u2026' }),
          state.status === 'error' &&
            _jsxs('p', {
              className: 'text-danger',
              children: ['API unreachable: ', state.message],
            }),
          state.status === 'loaded' &&
            _jsxs('p', {
              className: state.health.db === 'up' ? 'text-success' : 'text-warn',
              children: [
                'API ok: ',
                String(state.health.ok),
                ' \u00B7 database: ',
                state.health.db,
              ],
            }),
        ],
      }),
    ],
  });
}
