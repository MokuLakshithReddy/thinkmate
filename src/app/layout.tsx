import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { headers } from 'next/headers';
import './globals.css';

export const dynamic = 'force-dynamic';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
  title: 'ThinkMate — Personal AI Thinking Partner',
  description:
    'Collaborative problem-understanding partner that helps you clarify goals, decompose problems, explore alternatives, challenge assumptions, and turn decisions into action plans.',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Reading headers() opts RootLayout into per-request dynamic server rendering so Next.js
  // automatically binds the proxy-forwarded x-nonce to internal scripts without static cache collisions.
  await headers();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-purple-200 selection:text-purple-900">
        {children}
      </body>
    </html>
  );
}
