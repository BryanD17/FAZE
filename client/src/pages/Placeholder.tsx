export function Placeholder({ title }: { title: string }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-semibold">{title}</h1>
      <p className="mt-2 text-content-muted">Coming soon.</p>
    </main>
  );
}
