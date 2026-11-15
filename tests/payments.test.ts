import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { PLANS, paymentMatches, validSignature } from '../server/billing.js';
import { configuration, runAI } from '../server/accounts.js';

test('plans use INR paise and the exact requested pack sizes', () => {
  assert.deepEqual(PLANS.map(p => [p.amount, p.credits, p.currency]), [[2000, 1, 'INR'], [6000, 5, 'INR']]);
});
test('checkout signature binds the stored order ID to the payment ID', () => {
  const secret = 'test-secret'; const message = 'order_saved|pay_test';
  const signature = createHmac('sha256', secret).update(message).digest('hex');
  assert.equal(validSignature(message, signature, secret), true);
  assert.equal(validSignature('order_other|pay_test', signature, secret), false);
  assert.equal(validSignature(message, signature, 'wrong-secret'), false);
  for (const malformed of ['', 'aa', undefined, 123, 'z'.repeat(64)]) assert.equal(validSignature(message, malformed, secret), false);
});
test('webhook verification uses raw bytes, including whitespace', () => {
  const raw = Buffer.from('{ "event": "payment.captured" }');
  const secret = 'webhook-secret'; const signature = createHmac('sha256', secret).update(raw).digest('hex');
  assert.equal(validSignature(raw, signature, secret), true);
  assert.equal(validSignature(JSON.stringify(JSON.parse(raw.toString())), signature, secret), false);
});
test('only captured, unrefunded payments of the correct amount, currency and order qualify', () => {
  const purchase = { razorpay_order_id: 'order_test', amount: 6000 };
  const good = { order_id: 'order_test', amount: 6000, currency: 'INR', captured: true, status: 'captured', amount_refunded: 0 };
  assert.equal(paymentMatches(good, purchase), true);
  for (const change of [{ status: 'authorized' }, { captured: false }, { amount: 2000 }, { currency: 'USD' }, { order_id: 'order_other' }, { amount_refunded: 1 }]) assert.equal(paymentMatches({ ...good, ...change }, purchase), false);
});
test('interview configuration rejects oversized, missing and unrecognised inputs', () => {
  const good = { resumeText: 'My resume', company: 'Example', role: 'Engineer' };
  assert.equal(configuration(good).interviewTrack, 'full');
  assert.throws(() => configuration({ ...good, resumeText: 'x'.repeat(50001) }));
  assert.throws(() => configuration({ ...good, role: '' }));
  assert.throws(() => configuration({ ...good, interviewTrack: 'unlimited' }));
});
test('existing local engine produces a usable ten-question session without external keys', async () => {
  delete process.env.GEMINI_API_KEY; delete process.env.GOOGLE_AI_API_KEY;
  const result = await runAI({ action: 'generate-questions', resumeText: 'Test Candidate\nEngineer with React and TypeScript experience', role: 'Engineer', company: 'Example', interviewTrack: 'full' });
  assert.equal(result.questions.length, 10);
  assert.ok(result.questions.every((q: any) => typeof q.text === 'string' && q.text.length > 0));
});
