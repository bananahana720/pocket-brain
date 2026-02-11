# PocketBrain

**Your instant-access personal copilot.**

PocketBrain is an AI-powered note-taking app that captures your thoughts, tasks, and ideas -- then automatically organizes them for you. Type or speak a note, and Gemini AI classifies it, generates a title, extracts due dates, assigns priority, and tags it. Dump an entire stream of consciousness and let Magic Batch split it into atomic notes. Ask questions about your own notes with AI search. All data stays in your browser via localStorage.

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
- **Offline support** -- notes save to localStorage, offline banner when disconnected
- **Undo** -- undo delete, complete, and archive actions (Cmd+Z or toast button)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 19 |
| Language | TypeScript 5.8 |
| Build Tool | Vite 6 |
| AI | Google Gemini 2.5 Flash (`@google/genai`) or OpenRouter |
| Icons | Lucide React |
| Styling | Tailwind CSS |
| Storage | Browser localStorage |

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

**Option A: Google Gemini (default)**

```
GEMINI_API_KEY=your_gemini_api_key_here
```

**Option B: OpenRouter**

```
OPENROUTER_API_KEY=your_openrouter_api_key_here
```

If both keys are present, OpenRouter takes priority. The app uses the `google/gemini-2.5-flash` model by default -- OpenRouter routes this to the same Gemini model via their API, or you can modify the model string in `services/geminiService.ts` to use any OpenRouter-supported model.

The Vite config reads these variables and injects them at build time.

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
│   └── geminiService.ts     # All Gemini AI calls (analyze, batch, search, daily brief)
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
