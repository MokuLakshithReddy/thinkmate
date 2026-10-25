import Link from 'next/link';

export const metadata = {
  title: 'Terms of Service — ThinkMate',
  description: 'Terms of Service governing the use of ThinkMate AI Thinking Partner.',
};

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 px-6 py-16">
      <div className="max-w-3xl mx-auto space-y-8">
        <div>
          <Link href="/" className="text-xs text-sky-400 hover:underline">
            &larr; Back to ThinkMate
          </Link>
          <h1 className="text-3xl font-bold mt-4 tracking-tight">Terms of Service</h1>
          <p className="text-xs text-slate-400 mt-1">Effective Date: November 1, 2026 (Version 2026-11-01)</p>
        </div>

        <section className="space-y-3 text-sm text-slate-300 leading-relaxed">
          <h2 className="text-lg font-semibold text-white">1. Service Description</h2>
          <p>
            ThinkMate provides a structured AI thinking partner workspace designed to help users frame problems, evaluate claims, gather evidence, and make defensible decisions. ThinkMate generates AI assistance and proposals; you retain full control over what is accepted or confirmed into your thinking session.
          </p>
        </section>

        <section className="space-y-3 text-sm text-slate-300 leading-relaxed">
          <h2 className="text-lg font-semibold text-white">2. Accounts and Eligibility</h2>
          <p>
            You must be at least 18 years old, or have the valid consent of a parent or guardian, to create an account and use ThinkMate. You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account.
          </p>
        </section>

        <section className="space-y-3 text-sm text-slate-300 leading-relaxed">
          <h2 className="text-lg font-semibold text-white">3. User Content and Ownership</h2>
          <p>
            You own all thinking topics, problem statements, hypotheses, decisions, and content you submit to ThinkMate. We do not claim ownership of your intellectual property. We process your inputs solely to provide and operate the service, including passing prompts to authorized model providers (Google Gemini) for real-time response generation.
          </p>
        </section>

        <section className="space-y-3 text-sm text-slate-300 leading-relaxed">
          <h2 className="text-lg font-semibold text-white">4. Subscriptions, Payments, and Cancellations</h2>
          <p>
            Paid subscriptions (Pro, Team) are billed monthly in advance via Razorpay. You can cancel your subscription at any time through your Account page. Upon cancellation, your subscription remains active until the end of the current billing cycle, after which your account reverts to the Free tier.
          </p>
          <p>
            <strong>Refund Policy:</strong> If you experience technical defects preventing access to paid features that cannot be resolved within 48 hours of notification, you may request a pro-rated refund by contacting support.
          </p>
        </section>

        <section className="space-y-3 text-sm text-slate-300 leading-relaxed">
          <h2 className="text-lg font-semibold text-white">5. Account Deletion and Data Retention</h2>
          <p>
            You may permanently delete your account and all associated workspaces, messages, claims, and evidence at any time directly from the Account settings page. Account deletion is immediate, permanent, and cascades across all database records. Active subscriptions are cancelled prior to account deletion to prevent future charges.
          </p>
        </section>

        <section className="space-y-3 text-sm text-slate-300 leading-relaxed">
          <h2 className="text-lg font-semibold text-white">6. Acceptable Use and Disclaimers</h2>
          <p>
            You agree not to use ThinkMate for unlawful activities, credential stuffing, scraping, or attempting to compromise service integrity. ThinkMate is an assistive cognitive aid; outputs should not replace certified professional legal, medical, or financial advice.
          </p>
        </section>

        <section className="space-y-3 text-sm text-slate-300 leading-relaxed">
          <h2 className="text-lg font-semibold text-white">7. Governing Law and Grievances</h2>
          <p>
            These Terms are governed by the laws of India. For any inquiries, concerns, or grievances regarding these terms or your account, please contact our grievance officer at{' '}
            <a href="mailto:support@thinkmate.ai" className="text-sky-400 underline">
              support@thinkmate.ai
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
