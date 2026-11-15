import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Request, RequestHandler } from 'express';

let client: SupabaseClient | undefined;
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function database() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new HttpError(503, 'Accounts are temporarily unavailable. Please try again later.');
  return client ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export function checked<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) {
    const message = result.error.message;
    const known: Record<string, [number, string]> = {
      INSUFFICIENT_CREDITS: [402, 'You need an interview credit. Choose a pack to continue.'],
      INTERVIEW_NOT_FOUND: [404, 'Interview not found.'],
      INTERVIEW_CLOSED: [403, 'This interview has ended or its 24-hour practice window has closed.'],
      REQUEST_CONFLICT: [409, 'This request belongs to a different interview setup.'],
      GENERATION_EXPIRED: [409, 'Generation expired. Your credit has been restored. Start a new interview.'],
      USAGE_LIMIT: [429, 'The practice limit for this interview has been reached.'],
      RATE_LIMIT: [429, 'Too many requests. Please wait and try again.'],
    };
    const match = Object.entries(known).find(([key]) => message.includes(key));
    if (match) throw new HttpError(...match[1]);
    console.error('Database operation failed:', message);
    throw new HttpError(503, 'Unable to save your data. Please try again.');
  }
  return result.data;
}
export const authenticated: RequestHandler = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw new HttpError(401, 'Please sign in to continue.');
    const { data, error } = await database().auth.getUser(token);
    if (error || !data.user) throw new HttpError(401, 'Your session has expired. Please sign in again.');
    res.locals.user = data.user;
    next();
  } catch (error) { next(error); }
};
export async function limit(userId: string, action: string, max: number, seconds: number) {
  checked(await database().rpc('claim_request', { p_user: userId, p_action: action, p_max: max, p_seconds: seconds }));
}
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function interviewId(req: Request) {
  const id = req.body?.interviewId || req.get('X-Interview-Id');
  if (typeof id !== 'string' || !uuidPattern.test(id)) throw new HttpError(400, 'A valid interview is required.');
  return id;
}
export async function ownedInterview(userId: string, id: string) {
  const row = checked(await database().from('interviews').select('*').eq('id', id).eq('user_id', userId).maybeSingle());
  if (!row) throw new HttpError(404, 'Interview not found.');
  return row;
}
export function text(value: unknown, name: string, max: number, required = true): string {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw new HttpError(400, `Please provide a valid ${name} (up to ${max} characters).`);
  }
  return value.trim();
}
