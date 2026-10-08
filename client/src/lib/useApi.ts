import { useCallback, useEffect, useState } from 'react';
import { api } from './api.ts';

type State<T> = { data: T | null; error: unknown };

export function useApi<T>(path: string) {
  const [state, setState] = useState<State<T>>({ data: null, error: null });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api<T>(path)
      .then((data) => !cancelled && setState({ data, error: null }))
      .catch((error: unknown) => !cancelled && setState({ data: null, error }));
    return () => {
      cancelled = true;
    };
  }, [path, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  return { ...state, reload };
}
