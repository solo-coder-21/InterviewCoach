# Interview Coach

Resume-based mock interviews with email login, saved reports, and Razorpay interview credits.

| Pack | Price | Interview credits |
| --- | --- | --- |
| Single interview | ₹20 | 1 |
| Practice pack | ₹60 | 5 |

A credit starts one interview with 10 questions and follow-ups. Unused credits never expire. Resume an active interview for 24 hours. Generation failures restore the reserved credit.

## Run

Use Node.js 22.12+. Copy `.env.example` to `.env` and configure your own Supabase and Razorpay accounts. Run the included database migration before signing in.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. Full configuration, webhook URLs, deployment notes, and the test-mode checklist are in [SETUP.md](SETUP.md).

## Validate

```sh
npm run typecheck
npm test
npm run build
npm start
```

Tests use an in-memory PostgreSQL engine and local HTTP server. No real payments or external credentials are used. Production still requires testing your configured Supabase auth and Razorpay Test mode integration.

## Architecture

- React + Vite frontend; Express API shared by Node hosting and Vercel.
- Supabase Auth for email/password, verification and recovery; PostgreSQL/RLS for user isolation.
- Atomic SQL functions for credit purchases, reservations, failed-start recovery and usage limits.
- Razorpay server-created orders, captured-payment checks, signed callbacks/webhooks, and reconciliation.
- Existing Gemini/Speechmatics interview features, with local/browser fallbacks.

No real API keys are included. Payment links and personal UPI IDs are not required. All server secrets stay out of the frontend bundle.
