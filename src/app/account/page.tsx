import { redirect } from 'next/navigation';
import { createClient } from '@/lib/thinkmate/auth';
import { AccountPanel } from './AccountPanel';

export const metadata = { title: 'Account — ThinkMate' };

export default async function AccountPage() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user) {
    redirect('/login?next=/account');
  }

  return <AccountPanel email={user.email ?? ''} />;
}
