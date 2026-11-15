import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, ShieldCheck, ArrowRight, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { accountAPI } from '../utils/accountApi';

interface Plan { id: string; name: string; amount: number; credits: number; currency: string }
interface CheckoutResponse { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }
interface CheckoutOptions {
  key: string; amount: number; currency: string; name: string; description: string; order_id: string;
  prefill: { email?: string }; theme: { color: string }; modal: { ondismiss: () => void };
  handler: (response: CheckoutResponse) => void;
}
declare global {
  interface Window { Razorpay?: new (options: CheckoutOptions) => { open(): void; on(event: string, callback: () => void): void } }
}
let checkoutScript: Promise<void> | null = null;
function loadCheckout() {
  if (window.Razorpay) return Promise.resolve();
  return checkoutScript ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'; script.async = true;
    const timeout = window.setTimeout(fail, 20000);
    function fail() { window.clearTimeout(timeout); script.remove(); checkoutScript = null; reject(new Error('Unable to load secure checkout. Please try again.')); }
    script.onerror = fail;
    script.onload = () => { window.clearTimeout(timeout); if (window.Razorpay) resolve(); else fail(); };
    document.head.appendChild(script);
  });
}
export default function PricingPage() {
  const { user, account, refreshAccount } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  useEffect(() => {
    accountAPI<{ plans: Plan[]; checkoutAvailable: boolean }>('plans').then(data => { setPlans(data.plans); setAvailable(data.checkoutAvailable); }).catch(err => setError(err.message));
  }, []);
  async function buy(plan: Plan) {
    if (!user) { navigate('/auth?next=/pricing'); return; }
    setBusy(plan.id); setMessage(''); setError('');
    try {
      await loadCheckout();
      const order = await accountAPI<{ orderId: string; keyId: string; amount: number; currency: string }>('billing/orders', 'POST', { planId: plan.id });
      await new Promise<void>((resolve, reject) => {
        let submitted = false;
        const checkout = new window.Razorpay!({
          key: order.keyId, amount: order.amount, currency: order.currency, name: 'Interview Coach',
          description: `${plan.credits} interview credit${plan.credits === 1 ? '' : 's'}`, order_id: order.orderId,
          prefill: { email: user?.email }, theme: { color: '#287b80' },
          modal: { ondismiss: () => { if (!submitted) { setMessage('Checkout closed. If money was deducted, refresh payment status in your account.'); resolve(); } } },
          handler: response => {
            submitted = true;
            accountAPI<{ paid: boolean; message: string }>('billing/verify', 'POST', response)
              .then(data => { setMessage(data.message); resolve(); })
              .catch(() => reject(new Error('Payment confirmation is pending. Visit your account and refresh payment status. Credits are added after capture.')));
          },
        });
        checkout.on('payment.failed', () => setError('The payment attempt failed. You can retry inside checkout or close it.'));
        checkout.open();
      });
      await refreshAccount();
    } catch (err) { setError(err instanceof Error ? err.message : 'Checkout failed. Please try again.'); }
    finally { setBusy(''); }
  }
  return <main className="max-w-5xl mx-auto px-4 py-16 space-y-10">
    <div className="text-center max-w-2xl mx-auto space-y-4"><p className="text-primary font-bold text-sm tracking-widest">SMALL INVESTMENT. BETTER PREPARATION.</p>
      <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">Make your next interview count.</h1>
      <p className="text-foreground/65 text-lg">Choose a pack. Practice at your pace. No subscription.</p>
      {user && <Link to="/account" className="inline-block rounded-full bg-primary/10 px-4 py-2 text-primary font-semibold">{account ? `${account.credits} credits available` : 'View your credits'} <ArrowRight size={14} className="inline" /></Link>}
    </div>
    <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">{plans.map(plan => <article key={plan.id} className={`card relative space-y-5 ${plan.credits === 5 ? 'border-primary border-2' : ''}`}>
      {plan.credits === 5 && <span className="absolute -top-3 right-5 bg-primary text-on-primary rounded-full px-3 py-1 text-xs font-bold inline-flex gap-1 items-center"><Sparkles size={12} /> SAVE 40%</span>}
      <h2 className="text-xl font-semibold">{plan.name}</h2><p className="text-5xl font-bold">₹{plan.amount / 100}<span className="text-sm font-normal text-foreground/60"> / {plan.credits === 1 ? 'interview' : '5 interviews'}</span></p>
      <p className="text-primary font-semibold">₹{plan.amount / 100 / plan.credits} per interview</p>
      <ul className="space-y-3 text-sm">{['10 tailored interview questions', 'Technical, behavioral, AI & resume tracks', 'Voice or typed responses and follow-ups', 'Resume feedback and performance report', 'Unused credits never expire'].map(item => <li key={item} className="flex gap-2"><Check size={17} className="text-primary shrink-0" />{item}</li>)}</ul>
      <button className="btn-primary w-full" disabled={!!busy || user !== null && !available} onClick={() => void buy(plan)}>{busy === plan.id ? 'Opening checkout…' : user ? `Buy ${plan.credits} credit${plan.credits === 1 ? '' : 's'}` : 'Sign in to buy'}</button>
    </article>)}</div>
    <div className="max-w-3xl mx-auto space-y-4">
      {!available && plans.length > 0 && <p className="text-center text-sm text-foreground/65">Checkout is not available yet. You can create an account while it is being set up.</p>}
      {message && <p className="p-4 bg-primary/10 rounded-xl" role="status">{message} <Link className="underline" to="/account">View account</Link></p>}
      {error && <p className="text-destructive text-center" role="alert">{error}</p>}
      <p className="flex items-center justify-center gap-2 text-sm text-foreground/60"><ShieldCheck size={18} /> Secure checkout powered by Razorpay. Prices shown are the checkout total.</p>
      <div className="card text-sm text-foreground/65 space-y-3"><p>One credit starts one interview. You can resume that interview for 24 hours, including up to three follow-ups per question. A failed generation restores your credit automatically; a stalled start is recovered after 10 minutes.</p><p>Reports remain in your account. Your microphone is checked before a credit is used. If the AI service is unavailable, the interview uses the existing local practice engine. <Link className="underline" to="/terms">Purchase terms</Link></p></div>
    </div>
  </main>;
}
