import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import express, { type Express } from 'express';
import { authenticated, checked, database, HttpError, limit } from './database.js';

export const PLANS = [
  { id: 'single', name: 'Single interview', amount: 2000, credits: 1, currency: 'INR' },
  { id: 'five', name: 'Practice pack', amount: 6000, credits: 5, currency: 'INR' },
] as const;

export function validSignature(message: string | Buffer, signature: unknown, secret: string) {
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(message).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
export function paymentMatches(payment: any, purchase: any) {
  return payment.order_id === purchase.razorpay_order_id && payment.status === 'captured'
    && payment.captured === true && payment.amount === purchase.amount && payment.currency === 'INR'
    && (payment.amount_refunded ?? 0) === 0;
}
export function paymentsConfigured() {
  return !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && process.env.RAZORPAY_WEBHOOK_SECRET);
}
async function razorpay(endpoint: string, body?: object) {
  const { RAZORPAY_KEY_ID: key, RAZORPAY_KEY_SECRET: secret } = process.env;
  if (!key || !secret) throw new HttpError(503, 'Checkout is temporarily unavailable.');
  const response = await fetch(`https://api.razorpay.com/v1/${endpoint}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new HttpError(502, 'The payment provider could not complete this request. Please try again.');
  return response.json();
}
async function fulfill(purchase: any, payment: any) {
  if (!paymentMatches(payment, purchase)) return false;
  const order = await razorpay(`orders/${encodeURIComponent(purchase.razorpay_order_id)}`);
  if (order.status !== 'paid' || order.amount !== purchase.amount || order.currency !== 'INR' || order.amount_paid !== purchase.amount) return false;
  checked(await database().rpc('fulfill_purchase', { p_order: purchase.razorpay_order_id, p_payment: payment.id }));
  return true;
}
export function mountWebhook(app: Express) {
  // Must run before express.json(): Razorpay signs the exact raw bytes.
  app.post('/api/billing/webhook', express.raw({ type: 'application/json', limit: '256kb' }), async (req, res) => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) throw new HttpError(503, 'Webhooks are not configured.');
    if (!Buffer.isBuffer(req.body) || !validSignature(req.body, req.get('X-Razorpay-Signature'), secret)) {
      throw new HttpError(400, 'Invalid webhook signature.');
    }
    let event;
    try { event = JSON.parse(req.body.toString('utf8')); } catch { throw new HttpError(400, 'Invalid webhook.'); }
    if (!['payment.captured', 'order.paid'].includes(event.event)) { res.json({ received: true }); return; }
    const entity = event.payload?.payment?.entity;
    if (!entity?.id || !entity?.order_id) throw new HttpError(400, 'Missing payment information.');
    const purchase = checked(await database().from('purchases').select('*').eq('razorpay_order_id', entity.order_id).maybeSingle());
    if (purchase && purchase.status !== 'paid') {
      const payment = await razorpay(`payments/${encodeURIComponent(entity.id)}`);
      if (!await fulfill(purchase, payment)) throw new HttpError(409, 'Payment is not captured or does not match its order.');
    }
    res.json({ received: true });
  });
}
export function mountBilling(app: Express) {
  app.get('/api/plans', (_req, res) => res.json({ plans: PLANS, checkoutAvailable: paymentsConfigured() }));
  app.post('/api/billing/orders', authenticated, async (req, res) => {
    const user = res.locals.user;
    if (!paymentsConfigured()) throw new HttpError(503, 'Checkout is temporarily unavailable.');
    const plan = PLANS.find(p => p.id === req.body?.planId);
    if (!plan) throw new HttpError(400, 'Choose a valid interview pack.');
    await limit(user.id, 'checkout', 5, 60);
    const id = randomUUID();
    // Persist the intended price before contacting the provider. Client amounts are ignored.
    checked(await database().from('purchases').insert({ id, user_id: user.id, plan_id: plan.id, amount: plan.amount, credits: plan.credits }));
    const order = await razorpay('orders', { amount: plan.amount, currency: 'INR', receipt: id, notes: { purchase_id: id } });
    checked(await database().from('purchases').update({ razorpay_order_id: order.id }).eq('id', id));
    res.json({ orderId: order.id, amount: plan.amount, currency: 'INR', keyId: process.env.RAZORPAY_KEY_ID, credits: plan.credits });
  });
  app.post('/api/billing/verify', authenticated, async (req, res) => {
    await limit(res.locals.user.id, 'verify', 20, 60);
    const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body || {};
    if (typeof orderId !== 'string' || !/^order_[a-zA-Z0-9]+$/.test(orderId) || typeof paymentId !== 'string' || !/^pay_[a-zA-Z0-9]+$/.test(paymentId)) throw new HttpError(400, 'Invalid payment details.');
    const purchase = checked(await database().from('purchases').select('*').eq('razorpay_order_id', orderId).eq('user_id', res.locals.user.id).maybeSingle());
    if (!purchase) throw new HttpError(404, 'Order not found.');
    if (!process.env.RAZORPAY_KEY_SECRET || !validSignature(`${purchase.razorpay_order_id}|${paymentId}`, signature, process.env.RAZORPAY_KEY_SECRET)) throw new HttpError(400, 'Payment verification failed.');
    const payment = await razorpay(`payments/${encodeURIComponent(paymentId)}`);
    const paid = await fulfill(purchase, payment);
    res.status(paid ? 200 : 202).json({ paid, message: paid ? 'Credits added to your account.' : 'Payment is processing. Credits will appear after capture.' });
  });
  app.post('/api/billing/reconcile', authenticated, async (_req, res) => {
    await limit(res.locals.user.id, 'reconcile', 6, 60);
    const purchases = checked(await database().from('purchases').select('*').eq('user_id', res.locals.user.id).eq('status', 'created').not('razorpay_order_id', 'is', null).order('created_at', { ascending: false }).limit(10));
    for (const purchase of purchases || []) {
      const payments = await razorpay(`orders/${encodeURIComponent(purchase.razorpay_order_id)}/payments`);
      for (const payment of payments.items || []) {
        if (await fulfill(purchase, payment)) break;
      }
    }
    res.json({ message: 'Payment status refreshed.' });
  });
}
