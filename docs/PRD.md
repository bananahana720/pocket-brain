# PocketBrain PRD - From MVP to Polished Personal Copilot

## Vision
PocketBrain is your **instant-access personal copilot** — a mobile-first tool that captures thoughts at the speed of thinking and intelligently organizes your mental world. It should feel like texting yourself, but with a genius assistant filing everything perfectly.

## Target User
Andrew — a busy professional who needs to:
- Capture ideas/tasks/notes at any moment (walking, commuting, in meetings)
- Never lose a thought — zero-friction capture
- Track tasks with due dates and priorities without switching to a heavy app
- Remember key dates and appointments
- Review and plan daily/weekly
- Search across everything instantly

## Design Principles
1. **Speed > Features** — Every interaction should complete in under 1 second
2. **One-hand friendly** — Optimized for thumb-zone on mobile
3. **Smart defaults** — AI handles organization so the user doesn't have to
4. **Calm UI** — No visual clutter, progressive disclosure
5. **Offline-first** — Works without connectivity, syncs when available

---

## Sprint 1: Foundation & Polish (Core UX Refinements)

### S1.1 — Dark Mode with System Detection
- Auto-detect system preference via `prefers-color-scheme`
- Manual toggle in drawer
- Persist preference in localStorage
- All components must support both themes

### S1.2 — Pin & Archive System
- Pin important notes to top of list (star/pin icon)
- Archive completed tasks and old notes (swipe left or menu action)
- "Archived" section accessible from drawer
- Pinned notes always visible above unpinned

### S1.3 — Enhanced Note Types: Due Dates & Priority
- Tasks can have optional due date (date picker)
- Tasks can have priority: urgent, normal, low
- Visual indicators: red badge for overdue, amber for due today
- Sort tasks by due date when in Tasks filter

### S1.4 — Haptic Feedback & Micro-interactions
- Subtle animations on save, complete, delete
- Pull-to-refresh gesture
- Swipe actions on note cards (archive left, delete right)
- Button press feedback animations

### S1.5 — Quick Actions Bar
- Long-press on input opens quick action menu:
  - "New Task" (pre-sets type)
  - "New Idea" (pre-sets type)
  - "Voice Note" (starts recording immediately)
  - "Brain Dump" (opens batch mode directly)

---

## Sprint 2: Intelligence & Insights

### S2.1 — Daily Briefing View
- "Today" view showing:
  - Tasks due today / overdue
  - Recently captured notes
  - AI-generated daily summary
- Accessible via tap on header or dedicated tab

### S2.2 — Smart Reminders & Date Extraction
- AI automatically extracts dates from note content
  - "Call dentist on Thursday" → auto-creates due date
  - "Meeting at 3pm tomorrow" → extracts datetime
- Visual calendar dot indicator on notes with dates

### S2.3 — Tag Intelligence
- Clickable tags that filter notes
- AI-suggested tag merging ("work" + "office" → suggest merge)
- Tag cloud view in drawer
- Color-coded tag categories

### S2.4 — Streak & Productivity Insights
- Daily capture streak counter
- Weekly activity heatmap (like GitHub)
- "Your week in review" AI summary
- Stats: notes/day average, most active time, top tags

---

## Sprint 3: Reliability & Performance

### S3.1 — Undo System
- Undo last action (delete, archive, edit) with toast action button
- 5-second undo window
- Multi-level undo stack (last 10 actions)

### S3.2 — Virtual Scrolling
- Virtualize note list for 100+ notes
- Smooth scroll performance
- Maintain scroll position on updates

### S3.3 — Error Boundaries & Resilience
- React error boundaries around each section
- Graceful AI failure handling with retry buttons
- localStorage quota detection and warning
- Offline indicator banner

### S3.4 — Data Import & Enhanced Export
- Import from JSON backup
- Export as Markdown
- Export as CSV
- Drag-and-drop JSON import

---

## Sprint 4: Delight & Advanced Features

### S4.1 — Keyboard Shortcuts Panel
- `?` key opens shortcut overlay
- Document all shortcuts
- Customizable shortcuts in settings

### S4.2 — Note Templates
- Quick templates: "Meeting Notes", "Daily Plan", "Grocery List"
- Custom user-defined templates
- Template picker in quick actions

### S4.3 — Focus Mode
- Minimal UI mode — just input and current note
- Timer integration (Pomodoro-style)
- "Do Not Disturb" visual state

### S4.4 — PWA Installation
- Service worker for offline support
- App manifest with icons
- Install prompt
- Cache-first strategy for assets

---

## User Journeys

### Journey 1: Morning Quick Capture
Wake up → open app → voice "buy groceries, call mom, finish report" → Magic Batch splits into 3 items → AI tags "buy groceries" as TASK, "call mom" as TASK with today's date, "finish report" as TASK → done in 10 seconds

### Journey 2: Daily Planning
Open app → tap "Today" → see 4 tasks due, 2 overdue → AI briefing says "Focus on overdue report" → check off completed tasks → capture new thoughts → review takes 60 seconds

### Journey 3: Idea Incubation
Random idea strikes → pull out phone → type "what if we used webhooks for real-time sync" → AI classifies as IDEA, tags "engineering, architecture" → pin it → forget about it → find it later via AI search "what were my architecture ideas?"

### Journey 4: End of Day Review
Open drawer → see stats: 12 captures today, 5 tasks completed → weekly heatmap shows productive Wednesday → AI weekly summary highlights patterns → export week's notes as markdown for journaling

---

## Non-Goals (This Phase)
- Multi-device sync / backend (future phase)
- Collaboration / sharing
- Rich text / markdown editing
- File attachments
- Calendar integration (native)
- Push notifications (requires backend)
