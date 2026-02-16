# PocketBrain Security Audit Report

Date: 2026-02-16
Scope: Public site `https://app.pocket-brain.org`, public-origin exposure, VPS host hardening, deploy/runtime configuration, dependency vulnerability posture.

Remediation status (2026-02-16): All listed findings have been remediated in code/config and applied on the VPS. Validation evidence is documented in the session command outputs.

## Executive Summary

The highest-risk issue is **direct-origin exposure of the VPS**: the public IP (`15.204.218.124`) is reachable over `80/443` and serves the app/API directly, which allows bypassing Cloudflare controls and exposes operational endpoints (`/ready`, `/health`) to the internet. The second major issue is **host-header based redirect abuse** on port 80. Additional medium findings include missing browser hardening headers and unsafe deployment defaults for datastore credentials. Host hardening gaps (SSH password auth enabled, no fail2ban, stale firewall rule) increase brute-force and misconfiguration risk.

---

## Critical Findings

### [PB-SEC-001] Direct origin bypass exposes VPS app/API outside Cloudflare
- Severity: Critical
- Location: `/home/andrewhana/projects/pocket-brain/docker-compose.yml:57`, `/home/andrewhana/projects/pocket-brain/docker-compose.yml:58`
- Evidence:
  - `curl -k -I https://15.204.218.124/` returned `HTTP/1.1 200 OK` from `nginx/1.27.5`.
  - `curl -k -I 'https://15.204.218.124/api/v2/sync/pull?cursor=0'` returned `HTTP/1.1 401 Unauthorized` (API reachable directly by IP).
  - `curl -k -I https://15.204.218.124/api/v1/auth/status` returned `HTTP/1.1 404 Not Found` from origin nginx (proves direct origin pathing behavior).
- Impact (one sentence): Attackers who discover the origin IP can bypass Cloudflare-layer protections and target the VPS/API directly.
- Fix:
  - Restrict inbound `80/443` at host/network firewall to Cloudflare IP ranges only.
  - Optionally enforce Cloudflare-authenticated origin pulls / mTLS on origin.
  - Keep direct-origin health endpoints non-public (bind internal only or protect with allowlist/auth).
- Mitigation:
  - Add continuous checks that fail deployment if origin responds directly to non-Cloudflare source IPs.
- False positive notes:
  - Not a false positive; direct IP responses were reproduced at audit time.

### [PB-SEC-002] Public operational readiness endpoint leaks internal service state
- Severity: Critical
- Location: `/home/andrewhana/projects/pocket-brain/nginx/nginx.conf:14`, `/home/andrewhana/projects/pocket-brain/nginx/nginx.conf:15`
- Evidence:
  - `curl -sS -D - http://15.204.218.124/ready -o -` returned `200` and detailed JSON including dependency health/metrics (`database`, `redis`, maintenance counters, replay protection state).
- Impact (one sentence): Attackers can enumerate infrastructure health and internal behavior to improve targeted attack timing and fault exploitation.
- Fix:
  - Remove public routing for `/ready` (and `/health` if not required) on internet-facing listener.
  - Expose readiness only on loopback/private network, or require auth/allowlist.
- Mitigation:
  - Return minimal boolean readiness externally; keep detailed payload internal.
- False positive notes:
  - Verified from public internet against origin IP.

---

## High Findings

### [PB-SEC-003] Unsafe default datastore credentials and optional env loading
- Severity: High
- Location: `/home/andrewhana/projects/pocket-brain/docker-compose.yml:8`, `/home/andrewhana/projects/pocket-brain/docker-compose.yml:39`
- Evidence:
  - Postgres password defaults to `${POSTGRES_PASSWORD:-postgres}`.
  - API env file is marked `required: false`.
- Impact: Misconfigured/manual deployments can start with known credentials instead of failing fast.
- Fix:
  - Remove insecure defaults for secrets.
  - Make required env/secrets mandatory for production startup.
  - Add boot-time guard that exits on placeholder/default values.
- Mitigation:
  - CI/CD policy check to reject deploy if secrets are missing or default.
- False positive notes:
  - Current running environment may be correctly configured; this is a hardening gap that can fail open on operator error.

---

## Medium Findings

### [PB-SEC-004] Host-header open redirect on HTTP listener
- Severity: Medium
- Location: `/home/andrewhana/projects/pocket-brain/nginx/nginx.conf:19`
- Evidence:
  - `curl -I http://15.204.218.124/ -H 'Host: evil.example'` returned `Location: https://evil.example/`.
- Impact: Enables phishing/open-redirect abuse when users or scanners hit origin HTTP with attacker-controlled Host.
- Fix:
  - Replace redirect with canonical host: `return 301 https://app.pocket-brain.org$request_uri;`
  - Or validate `$host` against strict allowlist before redirect.
- Mitigation:
  - Drop unmatched hosts early with `444`/`400`.
- False positive notes:
  - Reproduced directly.

### [PB-SEC-005] Missing core browser hardening headers on served app
- Severity: Medium
- Location: `/home/andrewhana/projects/pocket-brain/nginx/nginx.conf:23`
- Evidence:
  - `curl -I https://app.pocket-brain.org` showed no `Content-Security-Policy`, no `X-Frame-Options`, no `X-Content-Type-Options`, no `Referrer-Policy`.
- Impact: Reduced defense-in-depth against XSS, clickjacking, and content-type confusion.
- Fix:
  - Add a conservative CSP and explicit hardening headers at edge/proxy.
  - Keep policy aligned with existing script/font requirements and test in report-only mode first.
- Mitigation:
  - If headers are intended at another layer, enforce and verify via automated external header tests.
- False positive notes:
  - Runtime headers were measured from the public domain at audit time.

---

## Low Findings

### [PB-SEC-006] SSH hardening posture allows password auth and root key login; no fail2ban
- Severity: Low
- Location: Runtime host config (VPS)
- Evidence:
  - `sshd -T` includes `passwordauthentication yes`, `permitrootlogin without-password`, `pubkeyauthentication yes`.
  - `systemctl is-active fail2ban` returned `inactive` / `not-found`.
- Impact: Increases brute-force attack surface and operational blast radius if account/key hygiene degrades.
- Fix:
  - Set `PasswordAuthentication no`.
  - Set `PermitRootLogin no`.
  - Add brute-force protections (`fail2ban` or equivalent network controls).
- Mitigation:
  - Restrict SSH source IPs via firewall where operationally possible.
- False positive notes:
  - Password auth does not prove a weak password exists; still a hardening gap.

### [PB-SEC-007] Unused firewall allowance for port 3000
- Severity: Low
- Location: Runtime host firewall (UFW)
- Evidence:
  - `ufw status` shows `3000/tcp ALLOW IN` while host listen table did not show an active service on 3000.
- Impact: Creates future accidental exposure if a process binds `0.0.0.0:3000`.
- Fix:
  - Remove `3000/tcp` UFW rule unless explicitly required.
- Mitigation:
  - Periodic firewall drift checks against expected service map.
- False positive notes:
  - Rule may be intentional for temporary workflows; not currently observed as an exposed live service.

---

## Checks Run (No Findings)

- Runtime config gates: `npm run config:check` passed.
- Remote precheck/verify: `npm run vps:precheck:remote` and `npm run vps:verify:remote` passed (repo clean, readiness OK).
- Dependency audit:
  - Root: `npm audit --omit=dev --json` reported `0` vulnerabilities.
  - Server: `npm --prefix server audit --omit=dev --json` reported `0` vulnerabilities.
- TLS protocol check:
  - TLS 1.0 / 1.1 not accepted.
  - TLS 1.2 / 1.3 accepted.

---

## Recommended Remediation Order

1. Block direct-origin access to VPS from non-Cloudflare sources (PB-SEC-001).
2. Remove/lock down public `/ready` exposure (PB-SEC-002).
3. Fix host-header redirect behavior (PB-SEC-004).
4. Enforce mandatory non-default datastore secrets (PB-SEC-003).
5. Add browser hardening headers/CSP with staged rollout (PB-SEC-005).
6. Harden SSH and firewall drift items (PB-SEC-006, PB-SEC-007).
