import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { loginRequestSchema } from '@faze/shared';
import { Field, fieldErrors, inputClass, primaryButtonClass } from '../components/Field.tsx';
import { messageOf } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';

export function Login() {
  const { state, login } = useAuth();
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice;
  const [values, setValues] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (state.status === 'signedIn') return <Navigate to="/profile" replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const parsed = loginRequestSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await login(parsed.data.email, parsed.data.password);
    } catch (err) {
      setFormError(messageOf(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="mb-6 text-3xl font-semibold">Log in</h1>
      {notice && (
        <p className="mb-4 rounded-sm border border-subtle bg-surface-raised p-3 text-sm">
          {notice}
        </p>
      )}
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field label="Email" htmlFor="email" error={errors.email}>
          <input
            id="email"
            type="email"
            autoComplete="email"
            className={inputClass}
            value={values.email}
            onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
          />
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password}>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            className={inputClass}
            value={values.password}
            onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
          />
        </Field>
        {formError && <p className="text-sm text-danger">{formError}</p>}
        <button type="submit" disabled={submitting} className={primaryButtonClass}>
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <p className="mt-6 text-sm text-content-muted">
        New here?{' '}
        <Link to="/register" className="text-accent hover:text-accent-hover">
          Create an account
        </Link>
      </p>
    </main>
  );
}
