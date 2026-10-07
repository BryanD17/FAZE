import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import { Home } from './pages/Home.tsx';
import { Placeholder } from './pages/Placeholder.tsx';

const links = [
  { to: '/groups', label: 'Groups' },
  { to: '/matches', label: 'Matches' },
  { to: '/profile', label: 'Profile' },
  { to: '/login', label: 'Log in' },
  { to: '/register', label: 'Register' },
];

function navClass({ isActive }: { isActive: boolean }) {
  return isActive ? 'text-accent' : 'text-content-muted hover:text-content-primary';
}

export function App() {
  return (
    <BrowserRouter>
      <header className="flex h-16 items-center justify-between border-b border-subtle px-6">
        <NavLink to="/" className="text-xl font-bold">
          FAZE
        </NavLink>
        <nav className="flex gap-5">
          {links.map((link) => (
            <NavLink key={link.to} to={link.to} className={navClass}>
              {link.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Placeholder title="Log in" />} />
        <Route path="/register" element={<Placeholder title="Register" />} />
        <Route path="/profile" element={<Placeholder title="Profile" />} />
        <Route path="/groups" element={<Placeholder title="Groups" />} />
        <Route path="/groups/:id" element={<Placeholder title="Group" />} />
        <Route path="/matches" element={<Placeholder title="Matches" />} />
        <Route path="*" element={<Placeholder title="Page not found" />} />
      </Routes>
    </BrowserRouter>
  );
}
