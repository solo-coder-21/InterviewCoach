import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { Navigate, useLocation } from 'react-router-dom';
import { accountAPI, supabase, type AccountData } from '../utils/accountApi';
import { setStorageOwner } from '../utils/storage';

interface AuthState {
  user: User | null; loading: boolean; account: AccountData | null; accountError: string;
  refreshAccount: () => Promise<void>; signOut: () => Promise<void>;
}
const AuthContext = createContext<AuthState | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState<AccountData | null>(null);
  const [accountError, setAccountError] = useState('');
  const userRef = useRef<User | null>(null);
  const applyUser = useCallback((next: User | null) => {
    if (userRef.current?.id !== next?.id) { setAccount(null); setAccountError(''); }
    userRef.current = next;
    setStorageOwner(next?.id || null);
    setUser(next); setLoading(false);
  }, []);
  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    let alive = true;
    supabase.auth.getSession().then(({ data }) => { if (alive) applyUser(data.session?.user || null); }).catch(() => { if (alive) applyUser(null); });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => applyUser(session?.user || null));
    return () => { alive = false; data.subscription.unsubscribe(); };
  }, [applyUser]);
  const refreshAccount = useCallback(async () => {
    const id = userRef.current?.id;
    if (!id) return;
    try {
      const next = await accountAPI<AccountData>('account');
      if (userRef.current?.id === id) { setAccount(next); setAccountError(''); }
    } catch (error) {
      if (userRef.current?.id === id) setAccountError(error instanceof Error ? error.message : 'Unable to load your account.');
    }
  }, []);
  useEffect(() => {
    if (!user) return;
    void refreshAccount();
    const refresh = () => { void refreshAccount(); };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [user?.id, refreshAccount]);
  const signOut = async () => {
    const { error } = await supabase!.auth.signOut();
    if (error) throw error;
    applyUser(null);
  };
  return <AuthContext.Provider value={{ user, loading, account, accountError, refreshAccount, signOut }}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider is required');
  return value;
}
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <p className="p-12 text-center" role="status">Loading your account…</p>;
  if (!user) return <Navigate to={`/auth?next=${encodeURIComponent(location.pathname)}`} replace />;
  return <>{children}</>;
}
