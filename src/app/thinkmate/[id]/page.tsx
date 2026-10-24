import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/thinkmate/auth';
import { loadState } from '@/lib/thinkmate/state';
import Workspace from './Workspace';

export const metadata = {
  title: 'ThinkMate Workspace — Thinking Partner Engine',
  description: 'Interactive thinking partner session with live problem framing and evidence verification.',
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const state = await loadState(sb, id);
  if (!state) {
    notFound();
  }

  return <Workspace initial={state} />;
}
