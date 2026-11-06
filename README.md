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
Resume parsing also requires a Google AI Studio Gemini API key in
`GEMINI_API_KEY`; `GEMINI_MODEL` defaults to `gemini-3.5-flash-lite`. The API
sends extracted resume text to Gemini to create and save a structured draft.
Uploaded files are processed in memory and are not stored.

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

Registration, login, refresh, email verification, and verification-resend
endpoints are rate-limited. Public registration always creates the `CANDIDATE`
role; assign `ADMIN` only through trusted administrative tooling.

## Resume builder and ATS-friendly PDF export

`POST /api/v1/resumes/parse-file` requires a candidate access token and a
multipart form field named `file`. It accepts PDF and DOCX files up to 5 MB.
PDF is recommended for ATS-friendly sharing. The API extracts text, sends it to
Gemini, and saves the structured draft and raw extracted text to the authenticated
user's MongoDB resume records. Uploaded files themselves are not stored.

Uploads are deduplicated per user using SHA-256 hashes of both the original file
bytes and normalized extracted text. Renaming a file does not bypass the check,
and re-uploading a differently encoded file is also rejected when its extracted
text is equivalent. A duplicate upload returns HTTP 409;
different resume content can be uploaded. Configure `GEMINI_API_KEY` in the API
environment before using this flow.

The signed-in workspace supports manual resume creation and editing of parsed
resumes. Experience and education entries can be added or removed, and the ATS
checks report layout guarantees and missing content sections. `POST /api/v1/resumes`
creates a manual resume, `GET /api/v1/resumes` lists the
authenticated user's resumes, `GET /api/v1/resumes/:id` reads one resume, and
`PUT /api/v1/resumes/:id` updates it. `GET /api/v1/resumes/:id/export-pdf`
downloads a selectable-text, single-column PDF with standard headings and no
tables. The current export uses a plain ATS-first layout; visual templates can
be added separately without changing resume data.

## Job description matching

`POST /api/v1/match/analyze` requires a candidate access token and accepts a
saved `resumeId` and raw `jobDescriptionText`. The API uses Natural's TF-IDF
cosine similarity as a fast initial score. Scores below 20% return
`analysisStatus: "skipped"` without calling Gemini. Scores of 20% or higher
continue to Gemini for matched hard skills, missing critical keywords, and
existing-bullet rewrites. Rewrites must not invent responsibilities or
quantifiable results. Resume access is restricted to its owner, and contact
details are not sent to Gemini. Redis caching is not implemented yet.

The response includes `matchScore` (0-100), `analysisStatus` (`skipped` or
`completed`), `matchedHardSkills`, `missingCriticalKeywords`, and
`bulletPointRewrites` (`originalBullet` and `rewrittenBullet`).

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
the React login/signup, resume upload, editing, builder, and job-matching
flows. API email calls are mocked in this suite, so they cannot contact Resend
or send messages.
`npm run test:mailtrap` is a separate opt-in integration test that sends one
message to the Mailtrap Email Sandbox; it requires `MAILTRAP_SMTP_USER` and
`MAILTRAP_SMTP_PASS` in
`apps/api/.env`. The message will appear in the sandbox inbox and is not
delivered to its test recipient.

## Project structure

- `apps/web` — React, TypeScript, and Vite single-page application
- `apps/api` — Express, TypeScript, and versioned REST API

Trending skills, analytics, Redis caching, and job workers are not included yet.
