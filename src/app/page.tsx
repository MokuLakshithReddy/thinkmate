import Link from 'next/link';
import { HeroDemo } from '@/components/marketing/HeroDemo';

export const metadata = {
  title: 'ThinkMate — An AI partner that helps you think, not just answer',
  description:
    'Frame the right problem, separate evidence from assumptions, and defend your own idea. AI proposes; you decide.',
};

const FEATURES = [
  ['Frame the problem', 'Get from a vague brief to a specific, scoped problem statement you can defend.'],
  [
    'Evidence, not guesses',
    "Every claim is tagged as yours or the AI's, and linked to evidence that supports or contradicts it.",
  ],
  ['You stay in charge', 'ThinkMate only proposes. Nothing joins your thinking until you confirm it.'],
] as const;

export default function Landing() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6 border-b border-slate-900">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-tr from-sky-400 to-indigo-500 p-[2px]">
            <div className="h-full w-full bg-slate-950 rounded-[6px] flex items-center justify-center font-bold text-sky-400 text-xs">
              TM
            </div>
          </div>
          <span className="font-bold text-lg tracking-tight">ThinkMate</span>
        </div>
        <nav className="flex items-center gap-6 text-sm text-slate-300">
          <Link href="/pricing" className="hover:text-white transition">
            Pricing
          </Link>
          <Link href="/app" className="hover:text-white transition">
            Try the demo
          </Link>
          <Link
            href="/login?next=/thinkmate"
            className="font-semibold text-sky-400 hover:text-sky-300 transition"
          >
            Sign in
          </Link>
        </nav>
      </header>

      <div className="flex-1">
        <section className="mx-auto grid max-w-5xl items-center gap-12 px-6 py-20 md:grid-cols-2">
          <div>
            <span className="inline-block px-3 py-1 mb-4 text-xs font-semibold rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20">
              AI Thinking Partner
            </span>
            <h1 className="text-4xl sm:text-5xl font-extrabold leading-tight tracking-tight text-white">
              Stop collecting AI answers. Start owning your idea.
            </h1>
            <p className="mt-5 text-slate-300 text-base leading-relaxed">
              ThinkMate guides you through problem framing, evidence verification, and trade-offs, so you can explain and defend your decision without the AI in the room.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                href="/login?next=/thinkmate"
                className="rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 px-6 py-3 text-sm font-semibold text-white transition shadow-lg shadow-sky-500/20"
              >
                Start free &rarr;
              </Link>
              <Link
                href="/pricing"
                className="rounded-xl border border-slate-700 hover:border-slate-500 px-6 py-3 text-sm font-medium text-slate-300 hover:text-white transition"
              >
                See pricing
              </Link>
            </div>
          </div>
          <HeroDemo />
        </section>

        <section className="mx-auto grid max-w-5xl gap-6 px-6 pb-20 md:grid-cols-3">
          {FEATURES.map(([t, d]) => (
            <div
              key={t}
              className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 space-y-2 hover:border-slate-700 transition"
            >
              <h2 className="font-semibold text-base text-white">{t}</h2>
              <p className="text-sm text-slate-400 leading-relaxed">{d}</p>
            </div>
          ))}
        </section>
      </div>

      <footer className="border-t border-slate-900 py-8 text-center text-xs text-slate-500">
        <div className="flex items-center justify-center gap-4">
          <Link href="/terms" className="hover:text-slate-400 underline">
            Terms
          </Link>
          <span>&middot;</span>
          <Link href="/privacy" className="hover:text-slate-400 underline">
            Privacy
          </Link>
          <span>&middot;</span>
          <Link href="/pricing" className="hover:text-slate-400 underline">
            Pricing
          </Link>
          <span>&middot;</span>
          <a href="mailto:support@thinkmate.ai" className="hover:text-slate-400">
            support@thinkmate.ai
          </a>
        </div>
      </footer>
    </main>
  );
}
