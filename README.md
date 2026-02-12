# PocketBrain

**Your instant-access personal copilot.**

PocketBrain is an AI-powered note-taking app that captures your thoughts, tasks, and ideas -- then automatically organizes them for you. Type or speak a note, and AI classifies it, generates a title, extracts due dates, assigns priority, and tags it. Dump an entire stream of consciousness and let Magic Batch split it into atomic notes. Ask questions about your own notes with AI search. Notes are persisted locally in IndexedDB with migration from legacy localStorage.

<!-- screenshot -->

---

## Features

### Capture
- **Quick capture** -- text input with auto-expanding textarea
- **Voice input** -- speak your notes using the Web Speech API
- **Quick action pills** -- one-tap Task, Idea, Voice, and Batch modes
- **Magic Batch (Brain Dump)** -- paste a wall of text and AI splits it into individual notes, tasks, and ideas

### AI Intelligence
- **Auto-classification** -- every note is categorized as NOTE, TASK, or IDEA
- **Auto-titling** -- AI generates concise titles (max 5 words)
- **Auto-tagging** -- up to 3 relevant tags per note
- **Due date extraction** -- AI detects dates like "call dentist Thursday" or "due tomorrow"
- **Priority detection** -- urgent, normal, or low priority inferred from content
- **AI search** -- ask natural language questions about your notes
- **Daily briefing** -- AI-generated summary of overdue tasks, today's priorities, and new captures

### Organization
- **Note types** -- NOTE (general), TASK (actionable), IDEA (creative)
- **Pin and archive** -- pin important notes to the top, archive completed ones
- **Tag system** -- clickable tags, tag filtering, tag cloud in the sidebar
- **Type filters** -- filter by All, Notes, Tasks, or Ideas
- **Text search** -- instant local search across titles, content, and tags

### Task Management
- **Checkbox completion** -- toggle tasks complete/incomplete
- **Due dates** -- manual date picker or AI-extracted dates
- **Priority levels** -- urgent (red), normal (amber), low (gray) with colored left borders
- **Overdue indicators** -- visual badges for overdue, due today, and tomorrow
- **Smart sorting** -- tasks sort by due date when filtered

### Productivity
- **Today View** -- daily dashboard with overdue, due today, and captured today sections
- **Daily streak** -- consecutive days with at least one capture
- **Weekly heatmap** -- Mon-Sun activity visualization
- **Completion rate** -- task completion percentage with progress bar
- **Overdue dot** -- red indicator on the Today button when tasks are overdue

### Data & Settings
- **Export** -- JSON, Markdown, or CSV
- **Import** -- JSON file import with validation and deduplication
- **Dark mode** -- auto-detects system preference, manual toggle in drawer
- **Offline support** -- notes save locally in IndexedDB, offline banner when disconnected
- **Undo** -- undo delete, complete, and archive actions (Cmd+Z or toast button)
- **Login-optional mode** -- use PocketBrain fully offline without signing in
- **Account sync** -- signed-in users get account-backed sync across devices with conflict handling
- **Account-level AI key** -- when signed in, AI provider keys are stored once per account (not per device)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 19 |
| Language | TypeScript 5.8 |
| Build Tool | Vite 6 |
| AI | Cloudflare Worker proxy + Gemini/OpenRouter providers |
| Icons | Lucide React |
| Styling | Tailwind CSS |
| Storage | Browser IndexedDB (+ operation log + snapshots) |

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- An AI API key (one of the following):
  - [Google Gemini API key](https://aistudio.google.com/apikey) (default)
  - [OpenRouter API key](https://openrouter.ai/keys) (alternative -- routes to many model providers)

### Install

```bash
git clone https://github.com/your-username/pocket-brain.git
cd pocket-brain
npm install
```

### Environment Setup

Create a `.env.local` file in the project root.

**Recommended production setup (secure):**

1. Deploy the Cloudflare Worker in `/worker` and route `/api/*` to it.
2. Set Worker secret: `KEY_ENCRYPTION_SECRET`.
3. Set Worker Clerk JWT verification vars together:
   - `CLERK_JWKS_URL`
   - `CLERK_ISSUER`
   - `CLERK_AUDIENCE`
4. Set Worker `ALLOW_INSECURE_DEV_AUTH=false` in production.
5. Configure server auth env:
   - `CLERK_SECRET_KEY`
   - `CLERK_PUBLISHABLE_KEY`
   - `ALLOW_INSECURE_DEV_AUTH=false`
   - `STREAM_TICKET_SECRET`
   - `STREAM_TICKET_TTL_SECONDS=60`
   - `MAINTENANCE_INTERVAL_MS=600000`
   - `TOMBSTONE_RETENTION_MS=2592000000`
   - `NOTE_CHANGES_RETENTION_MS=2592000000`
   - `SYNC_BATCH_LIMIT=100`
   - `SYNC_PULL_LIMIT=500`
   - `REQUIRE_REDIS_FOR_READY` defaults to `true` in production (`false` in dev/test); set explicitly to override
6. Create/connect your API key from the in-app drawer (`Menu > AI Security`).

If Worker Clerk vars are partial/missing while a bearer token is provided, the Worker responds with `AUTH_CONFIG_INVALID`.
If you are rolling out from an older server build that still has the compatibility toggle, set `ALLOW_LEGACY_SSE_QUERY_TOKEN=false` permanently before cutover. Current stream-ticket-only builds no longer use that flag.

Worker bootstrap commands:

```bash
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...
export KEY_ENCRYPTION_SECRET="$(openssl rand -hex 32)"
npm run worker:bootstrap
```

In this mode, provider keys are not stored in frontend code or browser storage.

### Sync Semantics

- Sync is enabled only when signed in. If not signed in, the app runs in local-only mode.
- Local edits are queued and retried automatically when connectivity returns.
- Pull/push is cursor-based and idempotent via request IDs.
- Realtime sync stream uses short-lived HttpOnly stream tickets (`POST /api/v2/events/ticket` then `GET /api/v2/events`).
- Field-level conflicts are handled safely:
  - disjoint local/server field changes are auto-merged and retried once
  - true field collisions are surfaced in the conflict modal for manual resolution
- Deletes are tombstoned and retained for reconciliation before pruning.

**Local development fallback (optional):**

Option A: Google Gemini
```
GEMINI_API_KEY=your_gemini_api_key_here
```

Option B: OpenRouter

```
OPENROUTER_API_KEY=your_openrouter_api_key_here
```

If both keys are present, OpenRouter takes priority. These env keys are used only for local development fallback; production should use the Worker proxy path.

Optional frontend sync queue pressure control:

```bash
VITE_SYNC_QUEUE_HARD_CAP=500
```

When pending sync operations reach the cap, the UI blocks additional note mutations until the queue drains (non-destructive policy). Queue-block events emit telemetry and a throttled in-app warning.

**Local proxy simulation (recommended for testing secure path):**

```bash
cp worker/.dev.vars.example worker/.dev.vars
npm run worker:dev
```

In another terminal:

```bash
npm run dev:proxy
```

### Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build for Production

```bash
npm run build
npm run preview
```

### VPS Quick Deploy

For existing VPS installs, use the helper script:

```bash
bash scripts/deploy-vps.sh
```

Options:
- `--with-worker`: also runs `npm run worker:deploy` after backend health checks.
- `--skip-pull`: skips `git pull --ff-only`.
- `--ready-retries <count>`: overrides readiness retry attempts (default `30`).
- `--ready-delay <seconds>`: overrides readiness retry delay (default `2`).

Deploy script now:
- validates compose config before restart
- auto-creates database `pocketbrain` if missing
- checks readiness on both direct API (`:8788/ready`) and nginx (`:8080/ready`)
- acquires a deploy lock (`/tmp/pocketbrain-deploy.lock`) to prevent overlapping runs
- prints compose status + logs on failure

`/ready` is the deployment health endpoint. `/` on nginx may return `404` and is not a deployment-failure signal.
Server metrics are available at `GET /metrics` for Prometheus scrape integration.

Dedicated multi-instance degradation validation:

```bash
npm run server:test:chaos
```

Prerequisites:
- run from repo root on VPS
- Docker and Docker Compose available
- if deploying worker, Cloudflare env auth vars are already exported

### Remote VPS Deploy From Local Machine

You can run VPS deploy/sync actions over SSH from your local repo checkout.

Preferred (persistent local config, not committed):

```bash
cp .vps-remote.env.example .vps-remote.env
# edit values once
```

The remote scripts auto-load `.vps-remote.env` and then `.env` for:
- `VPS_SSH_HOST`
- `VPS_PROJECT_DIR`
- `VPS_SSH_PORT`
- `VPS_SSH_IDENTITY`
- `VPS_SSH_RETRY_ATTEMPTS`
- `VPS_READY_RETRIES`
- `VPS_READY_DELAY_SECONDS`
- `VPS_POSTGRES_READY_RETRIES`
- `VPS_POSTGRES_READY_DELAY_SECONDS`

One-off shell exports also work:

```bash
export VPS_SSH_HOST=ubuntu@your-vps-host
export VPS_PROJECT_DIR=/srv/pocket-brain
# Optional:
export VPS_SSH_PORT=22
export VPS_SSH_IDENTITY=~/.ssh/id_ed25519
```

Run commands:

```bash
npm run vps:precheck:remote
npm run vps:sync:remote
npm run vps:deploy:remote
npm run vps:verify:remote
```

Optional deploy flags:

```bash
bash scripts/deploy-vps-remote.sh --with-worker
bash scripts/deploy-vps-remote.sh --skip-pull
bash scripts/deploy-vps-remote.sh --allow-stash
bash scripts/deploy-vps-remote.sh --ssh-retries 5
bash scripts/deploy-vps-remote.sh --ready-retries 45 --ready-delay 2
bash scripts/verify-vps-remote.sh --ready-retries 30 --ready-delay 2
```

Safe CD run order:

1. `npm run vps:precheck:remote`
2. `npm run vps:sync:remote`
3. `npm run vps:deploy:remote -- --skip-pull`
4. `npm run vps:verify:remote`

Notes:
- `vps:deploy:remote` now fails if the remote repo is dirty.
- Use `--allow-stash` only when you intentionally want to stash remote drift.
- `vps:deploy:remote` now prechecks remote docker/npm/.env prerequisites before deploy.
- Deploy automatically renders `server/.env` from root `.env` before runtime config validation.
- If remote deploy fails, scripts automatically print remote compose status and recent service logs.
- If `VPS_SSH_HOST` is set as a raw IP/hostname, scripts default to `ubuntu@<host>`.
- If `VPS_SSH_IDENTITY` is unset and `~/.ssh/id_ed25519` exists, scripts use it automatically.

---

## Project Structure

```
pocket-brain/
├── App.tsx                  # Main app component, state management, note actions
├── index.tsx                # React DOM entry point
├── types.ts                 # TypeScript types (Note, NoteType, UndoAction, etc.)
├── vite.config.ts           # Vite config with env variable injection
├── package.json
├── components/
│   ├── InputArea.tsx        # Bottom input bar, voice input, quick actions, batch mode
│   ├── NoteCard.tsx         # Individual note card with edit, menu, tags, due dates
│   ├── TodayView.tsx        # Daily dashboard (overdue, due today, captured today, AI brief)
│   ├── Drawer.tsx           # Side menu (stats, tags, theme toggle, export/import)
│   ├── Toast.tsx            # Toast notification system
│   └── ErrorBoundary.tsx    # React error boundary with recovery UI
├── services/
│   └── geminiService.ts     # AI client (proxy-first; dev fallback)
├── storage/
│   └── notesStore.ts        # IndexedDB persistence (ops log + snapshots + migration)
├── worker/
│   ├── src/index.ts         # Cloudflare Worker AI proxy + auth/session APIs
│   └── wrangler.toml        # Worker config
├── contexts/
│   └── ThemeContext.tsx      # Dark/light/system theme provider
├── utils/
│   └── exporters.ts         # Markdown, CSV export and JSON import validation
└── docs/
    └── USER_GUIDE.md        # Comprehensive user guide
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + K` | Focus search bar |
| `Cmd/Ctrl + I` | Focus input area |
| `Cmd/Ctrl + Enter` | Save current note |
| `Cmd/Ctrl + Z` | Undo last action (when not in a text field) |
| `Escape` | Close drawer, exit AI search, blur active element |

---

## License

MIT
