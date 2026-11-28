import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth.tsx';
import { GroupDetail } from './pages/GroupDetail.tsx';
import { Groups } from './pages/Groups.tsx';
import { Home } from './pages/Home.tsx';
import { Login } from './pages/Login.tsx';
import { Matches } from './pages/Matches.tsx';
import { Placeholder } from './pages/Placeholder.tsx';
import { Profile } from './pages/Profile.tsx';
import { Register } from './pages/Register.tsx';
import { Stats } from './pages/Stats.tsx';

const appLinks = [
  { to: '/groups', label: 'Groups' },
  { to: '/matches', label: 'Matches' },
  { to: '/profile', label: 'Profile' },
  { to: '/stats', label: 'Stats' },
];

// px-2 py-2 gives each link a comfortable tap target (about 40 px tall) on a phone.
const navItem = 'rounded-sm px-2 py-2';

function navClass({ isActive }: { isActive: boolean }) {
  return `${navItem} ${isActive ? 'text-accent' : 'text-content-muted hover:text-content-primary'}`;
}

function Header() {
  const { state, logout } = useAuth();
  return (
    <header className="flex min-h-16 flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-subtle px-4 py-3 sm:px-6">
      <NavLink
        to="/"
        aria-label="FAZE home"
        className="font-display text-2xl font-bold tracking-tight"
      >
        FA<span className="text-accent">Z</span>E
      </NavLink>
      <nav className="-mx-2 flex flex-wrap items-center gap-x-1 gap-y-1 sm:gap-x-3">
        {appLinks.map((link) => (
          <NavLink key={link.to} to={link.to} className={navClass}>
            {link.label}
          </NavLink>
        ))}
        {state.status === 'signedIn' && (
          <button
            type="button"
            className={`${navItem} text-content-muted hover:text-content-primary`}
            onClick={() => void logout()}
          >
            Log out
          </button>
        )}
        {state.status === 'signedOut' && (
          <>
            <NavLink to="/login" className={navClass}>
              Log in
            </NavLink>
            <NavLink to="/register" className={navClass}>
              Register
            </NavLink>
          </>
        )}
      </nav>
    </header>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  if (state.status === 'loading') return <p className="p-10 text-content-muted">Loading…</p>;
  if (state.status === 'signedOut') return <Navigate to="/login" replace />;
  return children;
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Header />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route
            path="/profile"
            element={
              <RequireAuth>
                <Profile />
              </RequireAuth>
            }
          />
          <Route
            path="/groups"
            element={
              <RequireAuth>
                <Groups />
              </RequireAuth>
            }
          />
          <Route
            path="/groups/:id"
            element={
              <RequireAuth>
                <GroupDetail />
              </RequireAuth>
            }
          />
          <Route
            path="/matches"
            element={
              <RequireAuth>
                <Matches />
              </RequireAuth>
            }
          />
          <Route
            path="/stats"
            element={
              <RequireAuth>
                <Stats />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Placeholder title="Page not found" />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
