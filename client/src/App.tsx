import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth.tsx';
import { Home } from './pages/Home.tsx';
import { Login } from './pages/Login.tsx';
import { Placeholder } from './pages/Placeholder.tsx';
import { Profile } from './pages/Profile.tsx';
import { Register } from './pages/Register.tsx';

const appLinks = [
  { to: '/groups', label: 'Groups' },
  { to: '/matches', label: 'Matches' },
  { to: '/profile', label: 'Profile' },
];

function navClass({ isActive }: { isActive: boolean }) {
  return isActive ? 'text-accent' : 'text-content-muted hover:text-content-primary';
}

function Header() {
  const { state, logout } = useAuth();
  return (
    <header className="flex h-16 items-center justify-between border-b border-subtle px-6">
      <NavLink to="/" className="text-xl font-bold">
        FAZE
      </NavLink>
      <nav className="flex items-center gap-5">
        {appLinks.map((link) => (
          <NavLink key={link.to} to={link.to} className={navClass}>
            {link.label}
          </NavLink>
        ))}
        {state.status === 'signedIn' && (
          <button
            type="button"
            className="text-content-muted hover:text-content-primary"
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
          <Route path="/groups" element={<Placeholder title="Groups" />} />
          <Route path="/groups/:id" element={<Placeholder title="Group" />} />
          <Route path="/matches" element={<Placeholder title="Matches" />} />
          <Route path="*" element={<Placeholder title="Page not found" />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
