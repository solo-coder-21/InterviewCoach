import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
export default function PrivacyPage() {
  const support = import.meta.env.VITE_SUPPORT_EMAIL;
  return <main className="max-w-4xl mx-auto px-4 py-16 space-y-6">
    <Link to="/" className="text-primary inline-flex gap-2 items-center"><ArrowLeft size={16} />Back to home</Link>
    <h1 className="text-4xl font-bold">Privacy Policy</h1><p className="text-sm text-foreground/60">Updated 15 November 2026</p>
    <section className="card space-y-3"><h2 className="text-xl font-bold">Accounts and interview records</h2><p>We use Supabase to manage your email/password account and store your credit balance, purchase references, resume text, interview questions, answers, and reports. Your account records are accessible to you and authorised service operators. A copy of your current interview and authentication session is kept in your browser to support sign-in and resuming practice. Signing out clears the current interview copy in this browser.</p></section>
    <section className="card space-y-3"><h2 className="text-xl font-bold">AI and speech services</h2><p>Resume text and interview responses may be sent to Google Gemini to generate questions and feedback. If configured, speech audio is streamed to Speechmatics for transcription and text is sent for speech synthesis. Browser speech services may be used as a fallback. This app does not store raw audio recordings in its database. Providers process data under their own policies; avoid including confidential information.</p></section>
    <section className="card space-y-3"><h2 className="text-xl font-bold">Payments</h2><p>Razorpay processes payments. We store order/payment references, pack details, payment status and the credit ledger. The app does not store your full card details, UPI PIN, or banking password. Checkout may receive your account email for prefilling.</p></section>
    <section className="card space-y-3"><h2 className="text-xl font-bold">Retention and requests</h2><p>Saved interviews and payment records remain available until removed by the service operator. Clearing browser data only removes the local copy. Contact support for account or data deletion requests; some financial records may need to be retained. The existing site also uses Vercel Analytics for site usage measurement.</p>{support && <p>Contact: <a className="text-primary underline" href={`mailto:${support}`}>{support}</a></p>}</section>
  </main>;
}
