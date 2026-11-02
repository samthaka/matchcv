# MatchCV

MatchCV is an AI-powered resume matching and analytics platform. This repository
starts as an npm-workspaces monorepo with a React web client and an Express API.

## Requirements

- Node.js 20.19 or newer
- npm 10 or newer

## Getting started

```sh
npm install
npm run dev
```

The web app runs at <http://localhost:5173>. The API runs at
<http://localhost:3000>, with a health check at
<http://localhost:3000/api/v1/health>. The Vite development server proxies
`/api` requests to the API.

## Authentication API

The API uses MongoDB at `mongodb://127.0.0.1:27017/matchcv` by default. Start
MongoDB locally, then add the variables from `.env.example` to your `.env`
(if you do not have one yet, copy the example):

```sh
if [ ! -f .env ]; then cp .env.example .env; fi
```

Set `RESEND_API_KEY` to your Resend key and generate distinct random values of
at least 32 bytes for `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` (for example,
with `openssl rand -base64 48`). `MONGODB_URI` can point to another MongoDB
instance. `API_PUBLIC_URL` must be the API's externally reachable base URL when
sending verification emails outside local development. `WEB_APP_URL` is where
the API redirects users after they confirm their email; set it to the deployed
frontend URL outside local development. `RESEND_FROM_EMAIL` defaults to
Resend's `onboarding@resend.dev` test sender; use a sender on a verified domain
for production.
The API validates both JWT secrets during startup. Set them in the `.env` file
loaded by the API process, then restart the API.

For local signup testing, use a Mailtrap **Email Sandbox** inbox so verification
messages are captured instead of delivered to real recipients. Copy the sandbox
SMTP username and password into `MAILTRAP_SMTP_USER` and `MAILTRAP_SMTP_PASS`,
then set `EMAIL_PROVIDER=mailtrap` in `apps/api/.env` (this is also the default
outside production). The integration always connects to Mailtrap's sandbox SMTP
host. Set `EMAIL_PROVIDER=resend` for production Resend delivery.

Authentication endpoints are mounted under `/api/v1/auth`:

- `POST /register` — accepts `{ "email": "...", "password": "..." }`, creates a
  candidate account, and sends a 24-hour verification link. The web app then
  directs the user to login with a reminder to check their email. Passwords
  must be at least 12 characters.
- `POST /verify-email` — verifies the token after the user explicitly submits
  the confirmation form opened by the email link, then redirects to the web
  app's login page; simply opening the link does not verify the account.
- `POST /verification/resend` — accepts `{ "email": "..." }` and requests a new
  verification email.
- `POST /login` — accepts the registration fields; verified accounts receive a
  15-minute bearer access token, while the 7-day refresh token is set in an
  HttpOnly cookie.
- `POST /refresh` — rotates the refresh cookie and returns a new access token.
- `POST /logout` — revokes the refresh token and clears the cookie.

All auth endpoints are rate-limited. Public registration always creates the
`CANDIDATE` role; assign `ADMIN` only through trusted administrative tooling.

## Workspace commands

```sh
npm run build
npm run lint
npm test
npm run test:mailtrap
npm run dev --workspace @matchcv/web
npm run dev --workspace @matchcv/api
```

`npm test` runs the API suite against a temporary in-memory MongoDB and tests
the React login/signup flows. API email calls are mocked in this suite, so they
cannot contact Resend or send messages. `npm run test:mailtrap` is a separate
opt-in integration test that sends one message to the Mailtrap Email Sandbox;
it requires `MAILTRAP_SMTP_USER` and `MAILTRAP_SMTP_PASS` in
`apps/api/.env`. The message will appear in the sandbox inbox and is not
delivered to its test recipient.

## Project structure

- `apps/web` — React, TypeScript, and Vite single-page application
- `apps/api` — Express, TypeScript, and versioned REST API

Resume processing, cache/queue, and AI integrations are not included yet.
