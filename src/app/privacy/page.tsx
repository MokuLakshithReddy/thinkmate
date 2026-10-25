import Link from 'next/link';

export const metadata = {
  title: 'Privacy Policy — ThinkMate',
  description: 'Privacy Policy detailing data processing, retention, and protection under DPDP Act 2023.',
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 px-6 py-16">
      <div className="max-w-3xl mx-auto space-y-8">
        <div>
          <Link href="/" className="text-xs text-sky-400 hover:underline">
            &larr; Back to ThinkMate
          </Link>
          <h1 className="text-3xl font-bold mt-4 tracking-tight">Privacy Policy</h1>
          <p className="text-xs text-slate-400 mt-1">Effective Date: November 1, 2026 (Version 2026-11-01)</p>
        </div>

        <section className="space-y-3 text-sm text-slate-300 leading-relaxed">
          <h2 className="text-lg font-semibold text-white">1. Information We Collect</h2>
          <p>We collect and store only the minimal information required to provide the ThinkMate thinking partner service:</p>
          <ul className="list-disc list-inside space-y-1 text-slate-400">
            <li><strong>Account Data:</strong> Email address and encrypted password hash (managed securely via Supabase Auth).</li>
            <li><strong>Workspace & Reasoning Data:</strong> Workspace titles, messages, proposed and confirmed claims, hypotheses, evidence links, and decision records.</li>
            <li><strong>Usage & Audit Metrics:</strong> Operational event counts (turn timestamps, token counts, latency, and session milestones) for quota enforcement and diagnostic health.</li>
            <li><strong>Consent Records:</strong> Timestamps and document versions of your acceptance of Terms and Privacy policies.</li>
            <li><strong>Billing Metadata:</strong> Subscription status and provider subscription IDs. Payment card numbers and CVVs are handled directly by Razorpay and are never seen or stored on our servers.</li>
          </ul>
        </section>

        <section className="space-y-3 text-sm text-slate-300 leading-relaxed">
          <h2 className="text-lg font-semibold text-white">2. Third-Party Service Processors</h2>
          <p>We transmit necessary data to the following vetted third-party service providers solely to operate ThinkMate:</p>
          <ul className="list-disc list-inside space-y-1 text-slate-400">
            <li><strong>Supabase:</strong> Managed database storage, Row-Level Security enforcement, and user authentication.</li>
            <li><strong>Google Cloud (Gemini API):</strong> Natural language model inference to process your reasoning turns and research requests. Prompts sent via enterprise API are governed by Google&apos;s API data commitments and are not used to train public foundational models.</li>
            <li><strong>Vercel:</strong> Edge hosting, serverless functions, and web serving infrastructure.</li>
            <li><strong>Upstash:</strong> Distributed in-memory Redis used exclusively for rate limiting and brute-force protection.</li>
            <li><strong>Razorpay:</strong> PCI-DSS compliant subscription billing and payment processing.</li>
          </ul>
        </section>

        <section className="space-y-3 text-sm text-slate-300 leading-relaxed">
          <h2 className="text-lg font-semibold text-white">3. Cookies and Ambient Authentication</h2>
          <p>
            ThinkMate uses strictly necessary <code>HttpOnly</code>, <code>SameSite=Lax</code> session cookies (<code>thinkmate_auth_token</code>, <code>sb-access-token</code>) to authenticate API requests and defend against Cross-Site Scripting (XSS). We do not use third-party tracking or advertising cookies.
          </p>
        </section>

        <section className="space-y-3 text-sm text-slate-300 leading-relaxed">
          <h2 className="text-lg font-semibold text-white">4. Data Retention, Portability, and Deletion</h2>
          <p>
            You have full ownership of your data. You may export your workspace history at any time using the Export function in the workspace header. You may also permanently delete your account and all associated data at any time from your Account settings. Account deletion immediately cascades across all database tables. Backups age out according to the Supabase backup retention schedule.
          </p>
        </section>

        <section className="space-y-3 text-sm text-slate-300 leading-relaxed">
          <h2 className="text-lg font-semibold text-white">5. Minors and Parental Consent</h2>
          <p>
            ThinkMate is not directed at children under the age of 18 without verifiable parental consent. Users confirm their age during signup. If we discover an account created without necessary consent, we will promptly delete all associated data.
          </p>
        </section>

        <section className="space-y-3 text-sm text-slate-300 leading-relaxed">
          <h2 className="text-lg font-semibold text-white">6. Grievance Redressal and Contact</h2>
          <p>
            In compliance with the Digital Personal Data Protection Act 2023, for questions, data subject requests, or grievances regarding your personal data, contact our Grievance Officer at{' '}
            <a href="mailto:privacy@thinkmate.ai" className="text-sky-400 underline">
              privacy@thinkmate.ai
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
