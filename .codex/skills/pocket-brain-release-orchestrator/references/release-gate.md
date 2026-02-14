# Release Gate Checklist

Use this sequence for production-oriented VPS releases.

## Canonical command order

1. `npm run vps:precheck:remote`
2. `npm run vps:sync:remote`
3. `npm run vps:deploy:remote -- --skip-pull`
4. `npm run vps:verify:remote`

Optional contract smoke check:

`npm run vps:smoke:public -- --base-url https://your-domain.example [--bearer <token>]`

## Flag guidance

- `--with-worker`: include Cloudflare worker deploy as part of VPS deploy path.
- `--skip-pull`: use after explicit sync step to avoid duplicate pull.
- `--allow-stash`: use only for intentional recovery from remote drift.
- `--ready-retries` and `--ready-delay`: increase only when infrastructure is known slow.

## Required success signals

- Remote precheck passes for SSH, repo layout, and runtime prerequisites.
- Remote deploy completes without runtime config-gate failure.
- `vps:verify:remote` reports `ready_status=200` and `api_ready_status=200`.
- Remote repo state is clean and expected SHA is present.
- Migration table check is present or intentionally reported unavailable with context.

## Required failure behavior

- Stop promotion on any failed stage.
- Surface command output and diagnostics.
- Evaluate rollback triggers before retrying deploy.
