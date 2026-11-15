import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { LockKeyhole, ArrowRight } from 'lucide-react';
import { supabase } from '../utils/accountApi';
import { useAuth } from '../context/AuthContext';

export default function AuthPage() {
  const [params] = useSearchParams();
  const [mode, setMode] = useState(params.get('mode') === 'reset' ? 'reset' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const next = ['/account', '/pricing', '/'].includes(params.get('next') || '') ? params.get('next')! : '/account';
  const changeMode = (value: string) => { setMode(value); setError(''); setMessage(''); setPassword(''); };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setMessage('');
    if (!supabase) { setError('Sign-in is not available yet. Please try again later.'); return; }
    setBusy(true);
    try {
      if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/auth?mode=reset` });
        if (error) throw error;
        setMessage('If an account exists for this email, a password reset link will arrive shortly.');
      } else if (mode === 'reset') {
        if (!user) throw new Error('Open the link from your password reset email first.');
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setPassword(''); setMessage('Password updated. You can continue to your account.');
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: `${window.location.origin}/account` } });
        if (error) throw error;
        if (data.session) navigate(next, { replace: true });
        else { setPassword(''); setMessage('Check your inbox to confirm your email, then sign in.'); }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        navigate(next, { replace: true });
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to sign in. Please try again.'); }
    finally { setBusy(false); }
  };
  return <main className="max-w-md mx-auto px-4 py-16">
    <div className="card space-y-6">
      <div className="w-12 h-12 bg-primary/10 text-primary rounded-2xl grid place-items-center"><LockKeyhole /></div>
      <div><p className="text-primary font-semibold text-sm mb-2">YOUR NEXT OPPORTUNITY STARTS HERE</p>
        <h1 className="text-3xl font-bold">{mode === 'signup' ? 'Create your account' : mode === 'forgot' ? 'Forgot your password?' : mode === 'reset' ? 'Choose a new password' : 'Welcome back'}</h1>
        <p className="text-foreground/60 mt-3">Keep your interview credits, practice sessions, and reports in one place.</p></div>
      {user && mode !== 'reset' ? <Link className="btn-primary" to={next}>Continue to your account <ArrowRight size={16} /></Link> :
      <form onSubmit={submit} className="space-y-4">
        {mode !== 'reset' && <label className="block text-sm font-semibold">Email<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} className="input mt-2" /></label>}
        {mode !== 'forgot' && <label className="block text-sm font-semibold">{mode === 'reset' ? 'New password' : 'Password'}<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'login' ? 1 : 8} value={password} onChange={e => setPassword(e.target.value)} className="input mt-2" />{mode !== 'login' && <span className="text-xs text-foreground/60 font-normal">Use at least 8 characters.</span>}</label>}
        <button className="btn-primary w-full" disabled={busy || loading || mode === 'reset' && !user}>{busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : mode === 'reset' ? 'Update password' : 'Sign in'}</button>
      </form>}
      {error && <p className="text-destructive text-sm" role="alert">{error}</p>}
      {message && <p className="bg-primary/10 p-3 rounded-lg text-sm" role="status">{message}</p>}
      <div className="flex flex-wrap gap-4 text-sm text-primary">
        <button onClick={() => changeMode(mode === 'signup' ? 'login' : 'signup')}>{mode === 'signup' ? 'Already have an account? Sign in' : 'Create an account'}</button>
        <button onClick={() => changeMode(mode === 'forgot' ? 'login' : 'forgot')}>{mode === 'forgot' ? 'Back to sign in' : 'Forgot password?'}</button>
      </div>
      <p className="text-xs text-foreground/60">By creating an account, you agree to the <Link to="/terms" className="underline">Terms</Link> and <Link to="/privacy" className="underline">Privacy Policy</Link>.</p>
    </div>
  </main>;
}
