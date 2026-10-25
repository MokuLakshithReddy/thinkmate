import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/thinkmate/auth';
import CreateWorkspaceForm from './CreateWorkspaceForm';
import type { WorkspaceRow } from '@/lib/thinkmate/state';

export const metadata = {
  title: 'ThinkMate Workspaces — AI Thinking Partner',
  description: 'Manage and launch your ThinkMate problem framing and innovation workspaces.',
};

export default async function ThinkMatePage() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user) {
    redirect('/login?next=/thinkmate');
  }

  const { data: workspaces } = await sb
    .from('tm_workspaces')
    .select('id, title, mode, stage, problem_frame_confirmed, created_at, updated_at')
    .order('updated_at', { ascending: false });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Navigation Header */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-indigo-500 via-sky-400 to-emerald-400 p-[2px]">
              <div className="h-full w-full bg-slate-950 rounded-[10px] flex items-center justify-center font-bold text-sky-400">
                TM
              </div>
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">ThinkMate</h1>
              <span className="text-[11px] text-sky-400 font-medium tracking-wide uppercase">
                Thinking Partner Engine
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <Link href="/account" className="text-slate-400 hover:text-sky-400 transition underline underline-offset-2">
              {user.email} (Account)
            </Link>
            <Link
              href="/pricing"
              className="px-3 py-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/30 transition"
            >
              Plans & Pricing
            </Link>
            <Link
              href="/app"
              className="px-3 py-1.5 rounded-lg border border-slate-700 hover:border-slate-500 text-slate-300 hover:text-white transition"
            >
              Classic Sessions
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-10 flex-1 w-full space-y-10">
        {/* Hero Section */}
        <div className="relative rounded-2xl p-8 overflow-hidden bg-gradient-to-br from-indigo-950/60 via-slate-900/80 to-slate-950 border border-slate-800 shadow-2xl">
          <div className="absolute top-0 right-0 -mt-10 -mr-10 w-96 h-96 bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="relative z-10 max-w-2xl">
            <span className="inline-block px-3 py-1 mb-4 text-xs font-semibold rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20">
              v1.0 Innovation Engine
            </span>
            <h2 className="text-3xl font-extrabold tracking-tight text-white mb-3">
              Shape your problems into defensible solutions
            </h2>
            <p className="text-slate-400 text-sm leading-relaxed mb-6">
              ThinkMate guides innovation through strict problem-framing, evidence discipline, and
              uncompromising independent defense. AI proposes; you decide.
            </p>
            <CreateWorkspaceForm />
          </div>
        </div>

        {/* Existing Workspaces Grid */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold tracking-tight text-slate-200">
              Your Workspaces ({workspaces?.length ?? 0})
            </h3>
          </div>

          {!workspaces || workspaces.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-800 p-12 text-center text-slate-500 bg-slate-900/30">
              <p className="text-base font-medium">No active thinking workspaces yet.</p>
              <p className="text-sm mt-1 text-slate-600">
                Enter a problem topic above to start a structured thinking session.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {((workspaces ?? []) as WorkspaceRow[]).map((ws) => (
                <Link
                  key={ws.id}
                  href={`/thinkmate/${ws.id}`}
                  className="group block p-5 rounded-xl border border-slate-800/80 bg-slate-900/40 hover:bg-slate-900/80 hover:border-sky-500/40 transition-all duration-200 shadow-sm hover:shadow-lg hover:shadow-sky-500/5 relative overflow-hidden"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-slate-800 text-slate-300 border border-slate-700/60 uppercase tracking-wider text-[10px]">
                      {ws.stage ?? 'orient'}
                    </span>
                    <span className="text-[11px] text-slate-500 capitalize">{ws.mode} Mode</span>
                  </div>

                  <h4 className="font-semibold text-slate-100 group-hover:text-sky-400 transition mb-2 line-clamp-2">
                    {ws.title}
                  </h4>

                  <div className="flex items-center justify-between text-xs text-slate-500 pt-3 border-t border-slate-800/60 mt-3">
                    <span>
                      {ws.problem_frame_confirmed ? (
                        <span className="text-emerald-400 font-medium">✓ Frame confirmed</span>
                      ) : (
                        <span className="text-amber-400/80">Pending frame</span>
                      )}
                    </span>
                    <span>
                      {new Date(ws.updated_at).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
