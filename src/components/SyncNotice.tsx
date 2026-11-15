import { useEffect, useState } from 'react';
import { loadSession, saveSession } from '../utils/storage';
import { useAuth } from '../context/AuthContext';

export default function SyncNotice() {
  const [failed, setFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const { user } = useAuth();
  useEffect(() => { setFailed(false); }, [user?.id]);
  useEffect(() => {
    const fail = () => setFailed(true);
    const ok = () => setFailed(false);
    window.addEventListener('interview-sync-error', fail);
    window.addEventListener('interview-sync-success', ok);
    return () => { window.removeEventListener('interview-sync-error', fail); window.removeEventListener('interview-sync-success', ok); };
  }, []);
  if (!failed || !user) return null;
  return <div role="alert" className="bg-amber-100 text-amber-950 px-4 py-3 text-sm text-center">Your latest progress is saved in this browser, but could not sync to your account. <button disabled={retrying} className="underline font-semibold" onClick={async () => { const session = loadSession(); if (session) { setRetrying(true); await saveSession(session); setRetrying(false); } }}>{retrying ? 'Saving…' : 'Retry saving'}</button></div>;
}
