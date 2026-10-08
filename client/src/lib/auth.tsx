import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AuthUser, SessionResponse } from '@faze/shared';
import { api, refreshSession, setAccessToken, setOnSignedOut } from './api.ts';

type AuthState =
  { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; user: AuthUser };

type AuthContextValue = {
  state: AuthState;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    setOnSignedOut(() => setState({ status: 'signedOut' }));
    void refreshSession().then((session) =>
      setState(session ? { status: 'signedIn', user: session.user } : { status: 'signedOut' }),
    );
    return () => setOnSignedOut(null);
  }, []);

  async function login(email: string, password: string) {
    const session = await api<SessionResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    setAccessToken(session.accessToken);
    setState({ status: 'signedIn', user: session.user });
  }

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      setAccessToken(null);
      setState({ status: 'signedOut' });
    }
  }

  return <AuthContext.Provider value={{ state, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
