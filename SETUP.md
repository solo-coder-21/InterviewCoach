# Set up Interview Coach accounts and payments

The app uses Supabase Auth + PostgreSQL and Razorpay Standard Checkout. You do
not need to provide a payment link or hard-code your personal UPI ID. You do need
your own Supabase project and Razorpay merchant API keys. New accounts start at
zero credits; only verified, captured purchases add credits.

## 1. Supabase

1. Create a Supabase project at https://supabase.com/dashboard.
2. Open **SQL Editor** and run `supabase/migrations/001_accounts_and_credits.sql`
   once against the new project. Keep the migration in version control. It is
   intentionally not a repeatable seed script.
3. In **Authentication > Providers**, enable email/password and email confirmation.
   Set a minimum password length of at least 8. Enable auth rate limits and use
   custom SMTP for real users (the built-in mail service is restricted).
4. In **Authentication > URL Configuration**, set your production Site URL and
   allow these redirect URLs:
   - `http://localhost:3000/account`
   - `http://localhost:3000/auth?mode=reset`
   - `https://YOUR-DOMAIN/account`
   - `https://YOUR-DOMAIN/auth?mode=reset`
   Adjust the localhost port if you change `PORT`.
5. Copy the project URL, browser anon/publishable key, and server
   service_role/secret key into the environment variables below. The browser key
   is deliberately public. The service-role key bypasses RLS and must stay on
   the server. Never give a `VITE_` prefix to a server secret.

## 2. Razorpay

1. Create your merchant account at https://dashboard.razorpay.com and start in
   **Test mode**. Generate a key ID and key secret.
2. Configure **automatic payment capture**. Credits are granted only when the
   payment is `captured` and the order is `paid`, never on authorisation alone.
3. Add a webhook URL:
   `https://YOUR-DOMAIN/api/billing/webhook`.
   Subscribe to **payment.captured** and **order.paid**. Set a strong random
   webhook secret and copy it to `RAZORPAY_WEBHOOK_SECRET`. This secret is
   separate from your API key secret. Configure both test and live webhooks
   separately. A publicly reachable HTTPS tunnel is needed for local webhooks.
4. The app sends server-created orders directly to checkout. Do not add your own
   payment URL. Prices are stored in paise: ₹20 = 2000 for 1 credit; ₹60 = 6000
   for 5 credits. Client-supplied prices and credit amounts are ignored.
5. Complete Razorpay merchant activation/KYC before switching to live keys.
   Test mode does not move real money. Standard pricing currently has no setup
   or annual maintenance charge, with transaction fees (published standard rate
   2% + GST; review your merchant agreement): https://razorpay.com/pricing/.

## 3. Environment variables

Copy `.env.example` to **`.env` in the repository root**, then replace all
placeholders. Both Express and Vite read `.env` in development.

| Variable | Where to get it | Public? |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL | Yes |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon / publishable API key | Yes |
| `SUPABASE_URL` | Same project URL | Yes, but server config |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role / server secret key | **No** |
| `RAZORPAY_KEY_ID` | Razorpay test/live key ID | Sent to checkout by server |
| `RAZORPAY_KEY_SECRET` | Matching Razorpay API key secret | **No** |
| `RAZORPAY_WEBHOOK_SECRET` | Secret you choose in webhook settings | **No** |
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey | **No** |
| `GEMINI_MODELS` | Optional comma-separated model IDs; defaults to `gemini-2.5-flash,gemini-2.5-pro` | Not sensitive |
| `SPEECHMATICS_API_KEY` | Speechmatics dashboard, optional | **No** |
| `VITE_SUPPORT_EMAIL` | Your monitored customer support email | Yes |
| `PORT` | Optional local port, default 3000 | Not sensitive |

`VITE_` values are embedded in the frontend at build time; rebuild after changing
them. In production, add the same variables in your hosting provider's settings.
Do not upload `.env` to GitHub. No credentials are included with this code.

## 4. Run locally

Use Node.js 22.12+ (or a supported newer LTS):

```sh
npm ci
npm run dev
```

Open http://localhost:3000. Sign up, confirm your email, then sign in. Open
Pricing and buy a pack using Razorpay Test mode. Refresh the account page to see
your credits. Start a practice session from the home page.

```sh
npm run typecheck
npm test
npm run build
npm start
```

`npm start` serves the production build. The included Vercel config keeps API
requests on the Express serverless function; set environment variables in Vercel,
run the migration in Supabase, and allow your Vercel domain in Supabase redirects.
Use a function duration that accommodates question generation. A worker killed
during generation is recovered when its owner next loads their account after
10 minutes. The ordinary Node server can also run on a persistent Node host.

## What is implemented

- Email sign-up, verification, login, logout, password reset, token refresh,
  protected pages, and per-account browser session storage.
- Wallet, payment history, interview history, resume and report retrieval.
- One credit reserves one interview, with idempotent start requests and atomic
  debits. Failed/stalled generation returns the credit exactly once.
- Server-only plan selection, HMAC checkout signatures, raw-body webhook
  verification, captured-payment/order checks, amount/currency matching, unique
  payment IDs, and atomic/idempotent credit grants.
- Webhooks recover payments even if the user closes checkout. **Refresh payment
  status** in Account reconciles the latest ten pending orders via Razorpay.
- Cross-account access is rejected. Database tables have RLS; browser roles can
  read only their own rows and cannot write wallets, purchases, sessions or call
  privileged credit functions. All billed AI/voice endpoints require an active,
  owned interview. AI, checkout and voice usage have database-backed limits.
- A session can resume for 24 hours, with 10 questions and up to 3 follow-ups per
  question. Completion closes paid API access; starting again uses a new credit.
  Unused purchased credits do not expire. Closing the tab alone does not create
  another charge. Reopening the saved interview resumes it.
- Local progress survives a sync failure, with a visible retry message. Completed
  reports can be downloaded using the original PDF feature.

## Validate before taking real payments

Automated tests exercise SQL transaction rules, ownership, RLS, replay handling,
credit recovery, HMAC verification, route rejection, and complete purchase/start/
completion flows with provider HTTP fixtures and real migration SQL. They do not replace a
full test against your Supabase project and Razorpay test merchant account.

Check signup/email confirmation/password recovery; both packs; a declined and
dismissed payment; replayed and forged callbacks; a closed checkout tab followed
by webhook/reconciliation; simultaneous starts with one credit; generation
failure; resume/completion; and an attempted read using another account.

Set your support email and review the terms/privacy text for your actual
business. Public launch also needs your merchant-required business/contact and
refund disclosures. Automated cash refunds, chargeback processing, tax invoices,
subscriptions, and an admin dashboard are not implemented. For a cash refund,
use the Razorpay dashboard and reconcile unused credits in the database before
refunding; the app deliberately does not initiate real refunds. Keep service-role
access restricted to trusted operators and back up the database.

The existing AI engine falls back to local practice questions/heuristic feedback
when keys or quota are unavailable; the pricing page discloses this. Google and
Speechmatics may have usage charges separate from Razorpay. No cloud project,
live merchant account, SMTP server, or domain is provisioned by this code.

Official integration references:
- https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/
- https://razorpay.com/docs/webhooks/validate-test/
- https://supabase.com/docs/guides/auth/passwords
- https://supabase.com/docs/guides/database/postgres/row-level-security
