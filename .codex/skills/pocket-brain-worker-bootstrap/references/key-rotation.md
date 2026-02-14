# Worker Key Rotation

Use overlap rotation to avoid breaking active sessions.

## Rotation sequence

1. Set previous secret temporarily:
   `npx wrangler secret put KEY_ENCRYPTION_SECRET_PREV --config worker/wrangler.toml`
2. Set new active secret:
   `npm run worker:secret:set`
3. Deploy worker:
   `npm run worker:deploy`
4. After session TTL window passes, remove previous secret:
   `npx wrangler secret delete KEY_ENCRYPTION_SECRET_PREV --config worker/wrangler.toml`

## Verification goals

- No sustained increase in `invalidRotationSecret`.
- Session decrypt and reconnect behavior remains healthy.
- Worker runtime config gate remains green after deploy.

## Safety notes

- Never set previous and active secrets to the same value.
- Never remove `KEY_ENCRYPTION_SECRET_PREV` before overlap window ends.
- Never print or commit secret values.
