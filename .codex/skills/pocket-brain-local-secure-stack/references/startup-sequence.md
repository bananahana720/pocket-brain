# Local Secure Stack Startup

Use this sequence for full local secure-path validation.

## Command order

1. Start infrastructure:
   `docker compose up -d postgres redis`
2. Prepare server env:
   `cp server/.env.example server/.env`
3. Prepare worker dev vars:
   `cp worker/.dev.vars.example worker/.dev.vars`
4. Ensure worker passthrough target:
   `VPS_API_ORIGIN=http://127.0.0.1:8788` in `worker/.dev.vars`
5. Start backend:
   `npm run server:dev`
6. Start worker:
   `npm run worker:dev`
7. Start frontend with proxy:
   `npm run dev:proxy`

## Health checks

- Server liveness: `http://localhost:8788/health`
- Server readiness: `http://localhost:8788/ready`
- Frontend app: `http://localhost:3000`

## Optional checks

- Headless E2E: `npm run test`
- Interactive E2E: `npm run test:ui`
