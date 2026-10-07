import { Link } from 'react-router-dom';

const floatingCard =
  'absolute hidden rounded border border-subtle bg-surface-raised px-5 py-3.5 shadow-raised md:block';

export function Home() {
  return (
    <main className="relative flex min-h-[calc(100vh-4rem)] items-center justify-center overflow-hidden text-center">
      <div className="z-10 max-w-2xl p-10">
        <p className="text-sm tracking-[4px] text-content-muted">FIND YOUR GROUP</p>

        <h1 className="my-2.5 text-8xl font-bold">FAZE</h1>

        <p className="mb-8 text-xl leading-normal text-content-muted">
          Find gamers who play the same games, at the same times, for the same reasons.
        </p>

        <Link
          to="/groups"
          className="inline-block rounded-sm bg-accent px-6 py-3.5 font-medium text-surface hover:bg-accent-hover"
        >
          Browse Groups →
        </Link>
      </div>

      <div className={`${floatingCard} left-[15%] top-[20%]`}>🎮 Valorant</div>
      <div className={`${floatingCard} bottom-[20%] right-[15%]`}>⛏️ Minecraft</div>
      <div className={`${floatingCard} right-[18%] top-[25%]`}>🏆 Ranked</div>
    </main>
  );
}
