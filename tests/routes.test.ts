import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';

let server: Server;
let origin: string;
before(async () => {
  process.env.NODE_ENV = 'test';
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
  const { createExpressApp } = await import('../server.js');
  server = createExpressApp().listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});
after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
test('every paid endpoint rejects anonymous calls before contacting any provider', async () => {
  for (const path of ['interviews', 'billing/orders', 'billing/verify', 'billing/reconcile', 'google-ai-chat', 'tts', 'speechmatics-token', 'scrape-questions']) {
    const response = await fetch(`${origin}/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 401, path);
  }
  for (const path of ['account', 'interviews/11111111-1111-4111-8111-111111111111']) assert.equal((await fetch(`${origin}/api/${path}`)).status, 401);
});
test('public plans remain visible while checkout is unconfigured', async () => {
  const response = await fetch(`${origin}/api/plans`);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.checkoutAvailable, false);
  assert.deepEqual(data.plans.map((p: any) => p.amount), [2000, 6000]);
});
test('unconfigured webhooks fail closed; bad JSON does not leak internals', async () => {
  assert.equal((await fetch(`${origin}/api/billing/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 503);
  const response = await fetch(`${origin}/api/billing/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Invalid JSON request.' });
});
test('unknown API routes return JSON and no wildcard CORS permission', async () => {
  const response = await fetch(`${origin}/api/unknown`);
  assert.equal(response.status, 404);
  assert.match(response.headers.get('content-type')!, /json/);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});
