---
name: pocket-brain-release-orchestrator
description: Execute the PocketBrain VPS release workflow with strict safety gates and rollback awareness. Use when asked to deploy to VPS, run precheck/sync/deploy/verify, perform release-gate checks, validate readiness after deploy, or decide whether to roll back a release.
---

# PocketBrain Release Orchestrator

Execute the canonical remote release sequence and stop promotion when rollback triggers fire.

## Workflow

1. Determine deployment intent and flags.
- Decide whether the run needs `--with-worker`, `--skip-pull`, or `--allow-stash`.
- Default to safe path: precheck, sync, deploy with `--skip-pull`, then verify.

2. Run release gate prerequisites.
- Read `references/release-gate.md`.
- Run `npm run vps:precheck:remote`.
- Run `npm run vps:sync:remote`.

3. Run deploy command.
- Run `npm run vps:deploy:remote -- --skip-pull` unless explicitly directed otherwise.
- Append `--with-worker` only when asked.
- Use `--allow-stash` only for intentional drift recovery.

4. Verify deploy output and health.
- Run `npm run vps:verify:remote`.
- Collect remote SHA, remote repo cleanliness, `:8080/ready`, and `:8788/ready` results from command output.
- Run optional smoke contract check when base URL is provided:
  `npm run vps:smoke:public -- --base-url <url> [--bearer <token>]`.

5. Evaluate rollback policy.
- Read `references/rollback-triggers.md`.
- Stop promotion and recommend rollback path if any trigger fires.
- Report healthy release only when triggers are clear and readiness checks pass.

## Reporting

Return:
- Command outcomes in execution order.
- Verification summary (SHA, readiness status, migration signal).
- Rollback-trigger evaluation.
- Clear next action.

## Safety

- Never print secret values or token contents.
- Never skip precheck and verify steps for production releases.
- Never run destructive git commands to force remote state.
