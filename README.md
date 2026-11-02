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

## Workspace commands

```sh
npm run build
npm run lint
npm run dev --workspace @matchcv/web
npm run dev --workspace @matchcv/api
```

## Project structure

- `apps/web` — React, TypeScript, and Vite single-page application
- `apps/api` — Express, TypeScript, and versioned REST API

Database, cache/queue, authentication, resume processing, and AI integrations
are intentionally not included in this initial scaffold.
