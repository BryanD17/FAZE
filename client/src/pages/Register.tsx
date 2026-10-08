import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { registerRequestSchema, type RegisterResponse } from '@faze/shared';
import { Field, fieldErrors, inputClass, primaryButtonClass } from '../components/Field.tsx';
import { api, ApiError, messageOf } from '../lib/api.ts';

export function Register() {
  const navigate = useNavigate();
  const [values, setValues] = useState({ email: '', password: '', displayName: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update(name: keyof typeof values, value: string) {
    setValues((v) => ({ ...v, [name]: value }));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const parsed = registerRequestSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      const res = await api<RegisterResponse>('/auth/register', {
        method: 'POST',
        body: parsed.data,
      });
      const notice = res.verificationRequired
        ? 'Account created. Open the link in your verification email, then log in.'
        : 'Account created. You can log in now.';
      navigate('/login', { state: { notice } });
    } catch (err) {
      if (err instanceof ApiError && err.field) setErrors({ [err.field]: err.message });
      else setFormError(messageOf(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="mb-6 text-3xl font-semibold">Create an account</h1>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field label="Email" htmlFor="email" error={errors.email}>
          <input
            id="email"
            type="email"
            autoComplete="email"
            className={inputClass}
            value={values.email}
            onChange={(e) => update('email', e.target.value)}
          />
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password}>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            className={inputClass}
            value={values.password}
            onChange={(e) => update('password', e.target.value)}
          />
          <p className="text-sm text-content-muted">
            At least 10 characters, with a letter and a number.
          </p>
        </Field>
        <Field label="Display name" htmlFor="displayName" error={errors.displayName}>
          <input
            id="displayName"
            autoComplete="nickname"
            className={inputClass}
            value={values.displayName}
            onChange={(e) => update('displayName', e.target.value)}
          />
        </Field>
        {formError && <p className="text-sm text-danger">{formError}</p>}
        <button type="submit" disabled={submitting} className={primaryButtonClass}>
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p className="mt-6 text-sm text-content-muted">
        Already have an account?{' '}
        <Link to="/login" className="text-accent hover:text-accent-hover">
          Log in
        </Link>
      </p>
    </main>
  );
}
