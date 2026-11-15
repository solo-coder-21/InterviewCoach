import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const user = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const config = { resumeText: 'Test resume', role: 'Engineer', company: 'Example', interviewTrack: 'full' };
async function call(name: string, args: unknown[]) {
  const values = args.map(v => typeof v === 'object' && v !== null ? JSON.stringify(v) : v);
  const result = await db.query<{ result: any }>(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as result`, values);
  return result.rows[0].result;
}
async function balance(id = user) {
  return (await db.query<{ credits: number }>('select credits from wallets where user_id = $1', [id])).rows[0]?.credits || 0;
}
async function purchase(credits = 1) {
  const id = randomUUID(); const order = `order_${id.replaceAll('-', '')}`;
  await db.query('insert into purchases(id,user_id,plan_id,amount,credits,razorpay_order_id) values($1,$2,$3,$4,$5,$6)', [id, user, credits === 1 ? 'single' : 'five', credits === 1 ? 2000 : 6000, credits, order]);
  return order;
}
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;`);
  await db.exec(await readFile(new URL('../supabase/migrations/001_accounts_and_credits.sql', import.meta.url), 'utf8'));
});
beforeEach(async () => {
  await db.exec('truncate auth.users cascade;');
  await db.query('insert into auth.users values($1),($2)', [user, other]);
});
after(() => db.close());

test('new accounts have zero credits and cannot start for free', async () => {
  await call('recover_interviews', [user]);
  assert.equal(await balance(), 0);
  await assert.rejects(call('reserve_interview', [user, randomUUID(), config]), /INSUFFICIENT_CREDITS/);
});
test('both packs grant exactly their purchased credits; confirmation replay is harmless', async () => {
  const single = await purchase(); const five = await purchase(5);
  assert.equal(await call('fulfill_purchase', [single, 'pay_single']), true);
  assert.equal(await call('fulfill_purchase', [single, 'pay_single']), false);
  await call('fulfill_purchase', [five, 'pay_five']);
  assert.equal(await balance(), 6);
  assert.equal((await db.query('select * from credit_ledger')).rows.length, 2);
});
test('one provider payment cannot fund two different orders', async () => {
  const a = await purchase(); const b = await purchase(5);
  await call('fulfill_purchase', [a, 'pay_unique']);
  await assert.rejects(call('fulfill_purchase', [b, 'pay_unique']), /unique/);
  assert.equal(await balance(), 1);
});
test('invalid plan prices are rejected by database constraints', async () => {
  await assert.rejects(db.query('insert into purchases(id,user_id,plan_id,amount,credits) values($1,$2,$3,$4,$5)', [randomUUID(), user, 'five', 20, 999]), /check constraint/);
});
test('duplicate start requests debit once; changed config and cross-account IDs fail', async () => {
  await call('fulfill_purchase', [await purchase(5), 'pay_start']);
  const id = randomUUID();
  assert.equal((await call('reserve_interview', [user, id, config])).created, true);
  assert.equal((await call('reserve_interview', [user, id, config])).created, false);
  assert.equal(await balance(), 4);
  await assert.rejects(call('reserve_interview', [user, id, { ...config, role: 'Other' }]), /REQUEST_CONFLICT/);
  await assert.rejects(call('reserve_interview', [other, id, config]), /INTERVIEW_NOT_FOUND/);
});
test('competing starts cannot spend the last credit twice', async () => {
  await call('fulfill_purchase', [await purchase(), 'pay_last']);
  const results = await Promise.allSettled([call('reserve_interview', [user, randomUUID(), config]), call('reserve_interview', [user, randomUUID(), config])]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(await balance(), 0);
});
test('failed generation returns a credit exactly once', async () => {
  await call('fulfill_purchase', [await purchase(), 'pay_failure']);
  const id = randomUUID(); await call('reserve_interview', [user, id, config]);
  await call('finish_generation', [user, id, null]);
  await assert.rejects(call('finish_generation', [user, id, null]), /GENERATION_EXPIRED/);
  assert.equal(await balance(), 1);
});
test('crashed generation is recovered after ten minutes; late worker cannot spend restored credit', async () => {
  await call('fulfill_purchase', [await purchase(), 'pay_stale']);
  const id = randomUUID(); await call('reserve_interview', [user, id, config]);
  await db.query("update interviews set created_at=now()-interval '11 minutes' where id=$1", [id]);
  await call('recover_interviews', [user]); await call('recover_interviews', [user]);
  assert.equal(await balance(), 1);
  await assert.rejects(call('finish_generation', [user, id, { id }]), /GENERATION_EXPIRED/);
});
test('ready sessions resume without a new debit and remain closed after completion', async () => {
  await call('fulfill_purchase', [await purchase(), 'pay_resume']);
  const id = randomUUID(); await call('reserve_interview', [user, id, config]);
  await call('finish_generation', [user, id, { id, questions: [] }]);
  assert.equal((await call('reserve_interview', [user, id, config])).interview.session_data.id, id);
  await call('claim_interview_usage', [user, id, 'ai', 1]);
  await assert.rejects(call('claim_interview_usage', [user, id, 'ai', 1]), /USAGE_LIMIT/);
  await assert.rejects(call('claim_interview_usage', [other, id, 'ai', 1]), /INTERVIEW_NOT_FOUND/);
  await db.query("update interviews set status='completed' where id=$1", [id]);
  await assert.rejects(call('claim_interview_usage', [user, id, 'ai', 10]), /INTERVIEW_CLOSED/);
  assert.equal(await balance(), 0);
});
test('24-hour expiry and request limits are enforced by SQL', async () => {
  await call('fulfill_purchase', [await purchase(), 'pay_expiry']);
  const id = randomUUID(); await call('reserve_interview', [user, id, config]);
  await call('finish_generation', [user, id, { id }]);
  await db.query("update interviews set created_at=now()-interval '25 hours' where id=$1", [id]);
  await assert.rejects(call('claim_interview_usage', [user, id, 'tts', 10]), /INTERVIEW_CLOSED/);
  await call('claim_request', [user, 'checkout', 1, 60]);
  await assert.rejects(call('claim_request', [user, 'checkout', 1, 60]), /RATE_LIMIT/);
});
test('browser role sees only its own rows and cannot mutate or call credit functions', async () => {
  await call('fulfill_purchase', [await purchase(), 'pay_rls']);
  await call('recover_interviews', [other]);
  await db.exec(`set role authenticated; set request.jwt.claim.sub='${other}';`);
  try {
    const rows = (await db.query<{ user_id: string }>('select * from wallets')).rows;
    assert.deepEqual(rows.map(r => r.user_id), [other]);
    assert.equal((await db.query('select * from purchases')).rows.length, 0);
    await assert.rejects(db.exec('update wallets set credits=999'), /permission denied/);
    await assert.rejects(call('fulfill_purchase', ['order_fake', 'pay_fake']), /permission denied/);
    await assert.rejects(call('reserve_interview', [other, randomUUID(), config]), /permission denied/);
  } finally { await db.exec('reset role'); }
  assert.equal(await balance(), 1);
});
