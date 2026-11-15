import { createClient } from '@supabase/supabase-js';
import type { InterviewSession } from './storage';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = url && key ? createClient(url, key) : null;
export class APIError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export async function authorizedFetch(url: string, init: RequestInit = {}) {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  const headers = new Headers(init.headers);
  if (session) headers.set('Authorization', `Bearer ${session.access_token}`);
  return fetch(url, { ...init, headers, credentials: 'same-origin' });
}
export async function accountAPI<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await authorizedFetch(`/api/${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({ error: 'Unable to reach the server. Please try again.' }));
  if (!response.ok) throw new APIError(response.status, data.error || 'Request failed. Please try again.');
  return data;
}
export interface AccountData {
  credits: number;
  purchases: { id: string; plan_id: string; amount: number; credits: number; status: string; razorpay_order_id: string | null; razorpay_payment_id: string | null; created_at: string }[];
  interviews: { id: string; status: string; created_at: string; role: string | null; company: string | null; scores?: { overall: number } }[];
}
export async function persistProgress(session: InterviewSession) {
  return accountAPI<{ session: InterviewSession }>(`interviews/${session.id}`, 'PUT', session);
}
