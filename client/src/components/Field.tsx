import type { ReactNode } from 'react';
import type { ZodError } from 'zod';

export const inputClass =
  'w-full rounded-sm border border-subtle bg-surface-raised px-3 py-2 text-content-primary';

export const primaryButtonClass =
  'rounded-sm bg-accent px-5 py-2.5 font-medium text-surface hover:bg-accent-hover disabled:opacity-60';

export const secondaryButtonClass =
  'rounded-sm border border-subtle px-3 py-1.5 text-sm text-content-muted hover:bg-surface-overlay hover:text-content-primary disabled:opacity-60';

export function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

export function fieldErrors(error: ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    errors[key] ??= issue.message;
  }
  return errors;
}
