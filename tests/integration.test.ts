import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID, createHmac } from 'node:crypto';
import type { Server } from 'node:http';
import { PGlite } from '@electric-sql/pglite';

// Exercise real Express + Supabase SDK + migration SQL with provider HTTP fixtures.
// Only Supabase/Razorpay HTTP boundaries are replaced. No external accounts needed.
const db = new PGlite();
const nativeFetch = globalThis.fetch;
const user = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const orders = new Map<string, any>();
const payments = new Map<string, any>();
let server: Server; let origin: string;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;`);
  await db.exec(await readFile(new URL('../supabase/migrations/001_accounts_and_credits.sql', import.meta.url), 'utf8'));
  await db.query('insert into auth.users values($1),($2)', [user, other]);
  Object.assign(process.env, { NODE_ENV: 'test', SUPABASE_URL: 'https://supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'server-test-key', RAZORPAY_KEY_ID: 'rzp_test_fixture', RAZORPAY_KEY_SECRET: 'provider-test-secret', RAZORPAY_WEBHOOK_SECRET: 'webhook-test-secret' });
  delete process.env.GEMINI_API_KEY; delete process.env.GOOGLE_AI_API_KEY;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init); const url = new URL(request.url);
    if (url.hostname === '127.0.0.1') return nativeFetch(input, init);
    const raw = await request.text(); const body = raw ? JSON.parse(raw) : null;
    if (url.hostname === 'supabase.test') {
      if (url.pathname === '/auth/v1/user') {
        const token = request.headers.get('Authorization')?.slice(7);
        if (![user, other].includes(token || '')) return json({ message: 'Invalid token' }, 401);
        return json({ id: token, email: 'fixture@example.test', aud: 'authenticated', role: 'authenticated' });
      }
      try {
        if (url.pathname.startsWith('/rest/v1/rpc/')) {
          const name = url.pathname.split('/').pop()!;
          assert.ok(['claim_request', 'recover_interviews', 'reserve_interview', 'finish_generation', 'fulfill_purchase', 'claim_interview_usage'].includes(name));
          const entries = Object.entries(body);
          const result = await db.query<{ result: unknown }>(`select public.${name}(${entries.map(([key], i) => `${key} => $${i + 1}`).join(',')}) as result`, entries.map(([, value]) => value !== null && typeof value === 'object' ? JSON.stringify(value) : value));
          return json(result.rows[0].result);
        }
        const table = url.pathname.split('/').pop()!;
        assert.ok(['wallets', 'purchases', 'interviews'].includes(table));
        const args: unknown[] = []; const where: string[] = [];
        for (const [key, value] of url.searchParams) {
          if (['select', 'order', 'limit'].includes(key)) continue;
          assert.ok(['id', 'user_id', 'status', 'razorpay_order_id'].includes(key));
          if (value === 'not.is.null') where.push(`${key} is not null`);
          else { assert.ok(value.startsWith('eq.')); args.push(value.slice(3)); where.push(`${key} = $${args.length}`); }
        }
        const condition = where.length ? ` where ${where.join(' and ')}` : '';
        let rows: any[];
        if (request.method === 'POST') {
          const entries = Object.entries(body);
          rows = (await db.query(`insert into ${table}(${entries.map(([key]) => key).join(',')}) values(${entries.map((_, i) => `$${i + 1}`).join(',')}) returning *`, entries.map(([, v]) => v))).rows;
        } else if (request.method === 'PATCH') {
          const entries = Object.entries(body);
          const values = entries.map(([, v]) => v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
          const assignments = entries.map(([key], i) => `${key} = $${args.length + i + 1}`).join(',');
          rows = (await db.query(`update ${table} set ${assignments}${condition} returning *`, [...args, ...values])).rows;
        } else {
          const suffix = url.searchParams.has('order') ? ' order by created_at desc' : '';
          rows = (await db.query(`select * from ${table}${condition}${suffix}` , args)).rows;
          if (url.searchParams.has('limit')) rows = rows.slice(0, Number(url.searchParams.get('limit')));
          if (url.searchParams.get('select')?.includes('session_data->')) rows = rows.map(row => ({ id: row.id, status: row.status, created_at: row.created_at, role: row.session_data?.role, company: row.session_data?.company, scores: row.session_data?.scores }));
        }
        return json(request.headers.get('Accept')?.includes('vnd.pgrst.object') ? rows[0] : rows);
      } catch (error) { return json({ message: (error as Error).message, code: 'TEST_DB' }, 400); }
    }
    if (url.hostname === 'api.razorpay.com') {
      assert.equal(request.headers.get('Authorization'), `Basic ${Buffer.from('rzp_test_fixture:provider-test-secret').toString('base64')}`);
      const parts = url.pathname.split('/').filter(Boolean);
      if (request.method === 'POST') {
        const id = `order_${orders.size + 1}`; const order = { ...body, id, amount_paid: 0, status: 'created' };
        orders.set(id, order); return json(order);
      }
      if (parts[1] === 'payments') return json(payments.get(parts[2]));
      if (parts[3] === 'payments') return json({ items: [...payments.values()].filter(p => p.order_id === parts[2]) });
      return json(orders.get(parts[2]));
    }
    throw new Error(`Unexpected external request: ${url.origin}`);
  };
  const { createExpressApp } = await import('../server.js');
  server = createExpressApp().listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});
after(async () => {
  globalThis.fetch = nativeFetch;
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  await db.close();
});
async function api(path: string, method = 'GET', body?: object, token = user) {
  const response = await nativeFetch(`${origin}/api/${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, data: await response.json() };
}
function capture(orderId: string, id: string) {
  const order = orders.get(orderId); order.status = 'paid'; order.amount_paid = order.amount;
  const payment = { id, order_id: orderId, status: 'captured', captured: true, amount: order.amount, currency: 'INR', amount_refunded: 0 };
  payments.set(id, payment); return payment;
}
test('signup wallet → server price → captured payment → interview → completion, with ownership and replay checks', async () => {
  assert.equal((await api('account')).data.credits, 0);
  const order = await api('billing/orders', 'POST', { planId: 'five', amount: 1, credits: 999 });
  assert.equal(order.status, 200); assert.equal(order.data.amount, 6000);
  const orderId = order.data.orderId;
  assert.equal((await api('billing/verify', 'POST', { razorpay_order_id: orderId, razorpay_payment_id: 'pay_1', razorpay_signature: 'a'.repeat(64) })).status, 400);
  capture(orderId, 'pay_1');
  const signature = createHmac('sha256', 'provider-test-secret').update(`${orderId}|pay_1`).digest('hex');
  const details = { razorpay_order_id: orderId, razorpay_payment_id: 'pay_1', razorpay_signature: signature };
  assert.equal((await api('billing/verify', 'POST', details, other)).status, 404);
  assert.equal((await api('billing/verify', 'POST', details)).data.paid, true);
  assert.equal((await api('billing/verify', 'POST', details)).data.paid, true);
  assert.equal((await api('account')).data.credits, 5);
  const request = { requestId: randomUUID(), resumeText: 'Test Candidate\nReact engineer with strong TypeScript skills', role: 'Engineer', company: 'Example' };
  const started = await api('interviews', 'POST', request);
  assert.equal(started.status, 200, JSON.stringify(started.data));
  assert.equal(started.data.session.questions.length, 10);
  const session = started.data.session;
  assert.equal((await api('interviews', 'POST', request)).data.session.id, session.id);
  assert.equal((await api('account')).data.credits, 4);
  assert.equal((await api(`interviews/${session.id}`, 'GET', undefined, other)).status, 404);
  assert.equal((await api('google-ai-chat', 'POST', { interviewId: session.id, action: 'generate-questions' })).status, 400);
  const scored = await api('google-ai-chat', 'POST', { interviewId: session.id, questionId: session.questions[0].id, action: 'score-answer', answer: 'I built a React application with TypeScript and improved the user experience through measured latency improvements.' });
  assert.equal(scored.status, 200, JSON.stringify(scored.data));
  session.questions[0].answerTranscript = 'My answer'; session.status = 'completed'; session.scores = { overall: 7 };
  assert.equal((await api(`interviews/${session.id}`, 'PUT', session)).data.session.status, 'completed');
  assert.equal((await api('tts', 'POST', { interviewId: session.id, text: 'test' })).status, 403);
  assert.equal((await api('account')).data.interviews[0].scores.overall, 7);
});
test('webhook and reconciliation recover closed checkouts exactly once', async () => {
  const a = await api('billing/orders', 'POST', { planId: 'single' }); capture(a.data.orderId, 'pay_webhook');
  const raw = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: payments.get('pay_webhook') } } });
  const signature = createHmac('sha256', 'webhook-test-secret').update(raw).digest('hex');
  const send = (sig: string) => nativeFetch(`${origin}/api/billing/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': sig }, body: raw });
  assert.equal((await send('b'.repeat(64))).status, 400);
  assert.equal((await send(signature)).status, 200);
  assert.equal((await send(signature)).status, 200);
  assert.equal((await api('account')).data.credits, 5);
  const b = await api('billing/orders', 'POST', { planId: 'single' }); capture(b.data.orderId, 'pay_reconcile');
  assert.equal((await api('billing/reconcile', 'POST', {})).status, 200);
  assert.equal((await api('account')).data.credits, 6);
});
test('a signed but merely authorised payment stays pending until capture', async () => {
  assert.equal((await api('account', 'GET', undefined, 'invalid-token')).status, 401);
  const order = await api('billing/orders', 'POST', { planId: 'single' });
  const orderId = order.data.orderId;
  payments.set('pay_authorized', { id: 'pay_authorized', order_id: orderId, status: 'authorized', captured: false, amount: 2000, currency: 'INR' });
  const signature = createHmac('sha256', 'provider-test-secret').update(`${orderId}|pay_authorized`).digest('hex');
  const response = await api('billing/verify', 'POST', { razorpay_order_id: orderId, razorpay_payment_id: 'pay_authorized', razorpay_signature: signature });
  assert.equal(response.status, 202); assert.equal(response.data.paid, false);
  assert.equal((await api('account')).data.credits, 6);
  capture(orderId, 'pay_authorized');
  assert.equal((await api('billing/reconcile', 'POST', {})).status, 200);
  assert.equal((await api('account')).data.credits, 7);
});
