# PocketBrain Sync Server

Fastify + PostgreSQL + Redis backend for account-backed note sync, device sessions, and conflict-aware push/pull APIs.

## Run locally

1. Start infra from repo root:

```bash
docker compose up -d postgres redis
```

2. Install deps:

```bash
npm install --prefix server
```

3. Configure env:

```bash
cp server/.env.example server/.env
```

4. Configure auth vars in `server/.env`:

- `CLERK_SECRET_KEY`
- `CLERK_PUBLISHABLE_KEY`
- `ALLOW_INSECURE_DEV_AUTH=true` only for local development

For production, set `ALLOW_INSECURE_DEV_AUTH=false`.

5. Start server:

```bash
npm --prefix server run dev
```

## Build

```bash
npm --prefix server run build
```
