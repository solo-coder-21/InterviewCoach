import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Coins, RefreshCw, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { accountAPI } from '../utils/accountApi';
import { saveSession, type InterviewSession } from '../utils/storage';

export default function AccountPage() {
  const { user, account, accountError, refreshAccount, signOut } = useAuth();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const navigate = useNavigate();
  async function open(id: string) {
    setBusy(id); setError('');
    try {
      const { session } = await accountAPI<{ session: InterviewSession }>(`interviews/${id}`);
      await saveSession(session, false);
      navigate(session.status === 'completed' ? '/results' : '/interview');
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to open interview.'); }
    finally { setBusy(''); }
  }
  async function reconcile() {
    setBusy('payments'); setError(''); setMessage('');
    try { await accountAPI('billing/reconcile', 'POST', {}); await refreshAccount(); setMessage('Payment status refreshed. Pending payments receive credits after capture.'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to refresh payments.'); }
    finally { setBusy(''); }
  }
  return <main className="max-w-5xl mx-auto px-4 py-10 space-y-8">
    <div className="flex flex-wrap gap-4 justify-between items-center"><div><p className="text-sm text-primary font-semibold">YOUR PRACTICE SPACE</p><h1 className="text-3xl font-bold mt-2">Your account</h1><p className="text-foreground/60 mt-2 break-all">{user?.email}</p></div>
      <button className="btn-ghost" onClick={() => { void signOut().then(() => navigate('/')).catch(err => setError(err.message)); }}><LogOut size={16} />Sign out</button></div>
    <section className="card bg-gradient-to-br from-primary/10 to-card flex flex-wrap justify-between items-center gap-6"><div><p className="flex items-center gap-2 text-primary font-semibold"><Coins size={20} /> Interview credits</p><p className="text-5xl font-bold my-3">{account?.credits ?? '—'}</p><p className="text-sm text-foreground/65">One credit per interview. Unused credits never expire.</p></div><div className="flex flex-wrap gap-3"><Link className="btn-primary" to="/">Start practicing <ArrowRight size={16} /></Link><Link className="btn-secondary" to="/pricing">Buy credits</Link></div></section>
    {(error || accountError) && <div role="alert" className="text-destructive">{error || accountError} <button className="underline" onClick={() => void refreshAccount()}>Retry</button></div>}
    {message && <p role="status" className="text-primary">{message}</p>}
    <section className="space-y-4"><div className="flex justify-between items-center"><h2 className="text-xl font-bold">Interview history</h2><button className="btn-ghost" onClick={() => void refreshAccount()} aria-label="Refresh account"><RefreshCw size={16} /></button></div>
      {!account && !accountError && <p role="status">Loading your interviews…</p>}
      {account?.interviews.length === 0 && <div className="card text-foreground/65">Your next interview starts here. Choose a pack and create your first practice session.</div>}
      <div className="space-y-3">{account?.interviews.map(item => {
        const expired = item.status === 'active' && Date.now() - new Date(item.created_at).getTime() >= 86400000;
        return <article className="card flex flex-wrap justify-between items-center gap-4" key={item.id}><div><h3 className="font-semibold">{item.role || 'Interview'}{item.company ? ` · ${item.company}` : ''}</h3><p className="text-sm text-foreground/60 mt-1">{new Date(item.created_at).toLocaleString('en-IN')} · {expired ? 'Practice window ended' : item.status === 'failed' ? 'Could not start · credit restored' : item.status === 'generating' ? 'Preparing · stalled starts recover after 10 minutes' : item.status === 'active' ? 'Ready to resume' : 'Completed'}</p>{item.scores && <p className="text-sm text-primary mt-1">Overall score: {item.scores.overall}/10</p>}</div>
          {['active', 'completed'].includes(item.status) && !expired && <button disabled={!!busy} onClick={() => void open(item.id)} className="btn-secondary">{busy === item.id ? 'Opening…' : item.status === 'completed' ? 'View report' : 'Resume interview'}</button>}</article>;
      })}</div>
    </section>
    <section className="space-y-4"><div className="flex flex-wrap justify-between items-center gap-3"><h2 className="text-xl font-bold">Payment history</h2><button disabled={!!busy} className="btn-ghost text-sm" onClick={() => void reconcile()}><RefreshCw size={16} />{busy === 'payments' ? 'Checking…' : 'Refresh payment status'}</button></div>
      {account?.purchases.length === 0 ? <p className="text-foreground/60">No purchases yet. <Link className="text-primary underline" to="/pricing">Explore packs</Link></p> : <div className="overflow-x-auto card"><table className="w-full text-sm text-left"><thead><tr className="border-b border-border"><th className="pb-3 pr-4">Date</th><th className="pb-3 pr-4">Pack</th><th className="pb-3 pr-4">Total</th><th className="pb-3">Status / reference</th></tr></thead><tbody>{account?.purchases.map(p => <tr key={p.id} className="border-b border-border/50 last:border-0"><td className="py-4 pr-4 whitespace-nowrap">{new Date(p.created_at).toLocaleDateString('en-IN')}</td><td className="pr-4">{p.credits} interview{p.credits === 1 ? '' : 's'}</td><td className="pr-4">₹{p.amount / 100}</td><td>{p.status === 'paid' ? 'Paid · credits added' : 'Pending / not paid'}<span className="block text-xs text-foreground/50 break-all mt-1">{p.razorpay_payment_id || p.razorpay_order_id || p.id}</span></td></tr>)}</tbody></table></div>}
      <p className="text-xs text-foreground/60">A pending order does not mean you were charged. If money was deducted, refresh payment status. Your credit balance updates only after verified capture.</p>
    </section>
  </main>;
}
