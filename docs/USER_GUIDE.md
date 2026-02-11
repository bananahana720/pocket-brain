# PocketBrain User Guide

Everything you need to know to get the most out of PocketBrain -- your instant-access personal copilot.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Quick Capture](#quick-capture)
3. [Quick Actions](#quick-actions)
4. [Magic Batch (Brain Dump)](#magic-batch-brain-dump)
5. [AI Classification](#ai-classification)
6. [Note Types](#note-types)
7. [Task Management](#task-management)
8. [Pin and Archive](#pin-and-archive)
9. [Search](#search)
10. [Tag System](#tag-system)
11. [Today View (Daily Briefing)](#today-view-daily-briefing)
12. [Dark Mode](#dark-mode)
13. [Undo](#undo)
14. [Productivity Stats](#productivity-stats)
15. [Import and Export](#import-and-export)
16. [Keyboard Shortcuts](#keyboard-shortcuts)
17. [Tips and Tricks](#tips-and-tricks)
18. [Troubleshooting](#troubleshooting)

---

## Getting Started

When you first open PocketBrain, you will see a clean screen with the message "Your mind is clear" and an input bar pinned to the bottom of the screen. That input bar is your primary way of interacting with the app.

To capture your first note:

1. Tap or click the text area at the bottom of the screen.
2. Type anything -- a thought, a task, a random idea.
3. Press the Send button (the purple arrow) or hit **Cmd/Ctrl + Enter**.

That is it. The note appears instantly at the top of your list. Within a second or two, PocketBrain's AI analyzes your note in the background and adds a title, tags, a type classification, and (if relevant) a due date and priority level.

The header at the top contains:
- The **PocketBrain** logo and name on the left.
- A **Today** button (calendar icon) on the right.
- A **Menu** button (hamburger icon) that opens the side drawer.
- A **search bar** below the header with an **AI toggle** button.

Below the search bar, you will see filter pills: **All**, **Notes**, **Tasks**, and **Ideas**. These let you quickly narrow your view.

---

## Quick Capture

### Text Input

The input area is the rounded text field at the bottom of the screen. It auto-expands as you type, up to a maximum height. When you are done, save with the Send button or **Cmd/Ctrl + Enter**.

If you have text in the input and it is longer than 5 characters, two buttons appear to the right:
- A **purple wand** button -- this triggers Magic Batch split on your text.
- A **purple arrow** button -- this saves the note normally.

If the text is 5 characters or fewer, the send button is grayed out.

You can clear your text at any time by tapping the small X that appears inside the text area.

### Voice Input

If your browser supports the Web Speech API (Chrome, Edge, and most Chromium-based browsers), you will see a microphone button next to the text input.

1. Tap the **Mic** button. The input area border turns red, and a pulsing red dot appears to indicate recording.
2. Speak naturally. Your words are transcribed in real time and appended to the text area.
3. Tap the **Mic** button again (now showing a mic-off icon) to stop recording.
4. Review the transcription, then save it like any other note.

You can also start voice input from the quick action pills (see below).

### Saving

- **Cmd/Ctrl + Enter** saves the current note from the text area.
- The Send button does the same thing.
- After saving, the text area clears and refocuses so you can immediately capture the next thought.

---

## Quick Actions

Above the text input, you will see a row of pill-shaped buttons. These are the Quick Actions:

### Task

Tap the **Task** pill to pre-set the note type as TASK. The pill highlights green, and the placeholder text changes to "Creating a Task...". When you save, the note skips AI classification and is immediately stored as a task. Tap the pill again to deselect it and return to normal mode.

### Idea

Tap the **Idea** pill to pre-set the note type as IDEA. The pill highlights amber, and the placeholder changes to "Creating an Idea...". Same behavior as the Task pill -- saves immediately as an idea without waiting for AI. Tap again to deselect.

### Voice

Tap the **Voice** pill to start voice recording. This is the same as tapping the microphone button. The pill highlights red while recording. Tap again to stop.

### Batch

Tap the **Batch** pill to enter Brain Dump mode. The pill highlights violet, the text area expands to a larger size, and the placeholder changes to "Dump multiple thoughts here, AI will split them...". When you save in this mode, your text goes through the Magic Batch processor instead of being saved as a single note. Tap the pill again to exit batch mode.

When you start typing and the quick actions are not selected, the pill row hides to give you more space. It reappears when you stop focusing on the input or when a pill is active.

---

## Magic Batch (Brain Dump)

Magic Batch is one of PocketBrain's most powerful features. It takes a messy block of text and uses AI to split it into individual, organized notes.

### How to Use It

**Method 1: Batch Mode**
1. Tap the **Batch** pill in the quick actions row.
2. Type or paste your brain dump. The text area is larger in this mode.
3. Press the wand button or hit **Cmd/Ctrl + Enter**.

**Method 2: Inline Wand Button**
1. Type any text longer than 5 characters in the normal input.
2. A purple wand button appears to the left of the send button.
3. Tap the wand button to batch-process your text instead of saving it as a single note.

### What Happens

When you trigger a batch split:
1. A full-screen overlay appears with the message "Organizing thoughts..." and a brain icon.
2. The AI reads your text and identifies distinct items within it.
3. Each item is split into its own note, complete with a title, tags, and type (NOTE, TASK, or IDEA).
4. All the new notes appear in your list at once.
5. A toast notification tells you how many notes were created (for example, "Created 4 notes from batch").

### Examples

**Input:**
"Need to buy groceries tomorrow, also had an idea for a blog post about productivity tools, and I should call the dentist before Friday. Oh and remember that quote from the book -- 'The best time to plant a tree was 20 years ago.'"

**Output:** Four separate notes:
- TASK: "Buy groceries" (tagged: shopping, errands; due: tomorrow)
- IDEA: "Blog post on productivity tools" (tagged: writing, blog)
- TASK: "Call the dentist" (tagged: health, appointment; due: Friday)
- NOTE: "Tree planting quote" (tagged: quotes, inspiration)

If the AI cannot split the text for any reason, PocketBrain saves it as a single note instead and shows an error toast.

---

## AI Classification

Every note you capture (unless you pre-select a type using the Task or Idea quick actions) gets analyzed by Gemini AI in the background. Here is what happens:

1. **Title** -- A short, punchy title is generated (maximum 5 words). This appears in bold at the top of the note card.
2. **Type** -- The note is classified as NOTE, TASK, or IDEA based on the content.
3. **Tags** -- Up to 3 relevant tags are generated and displayed below the note content.
4. **Due date** -- If the content mentions a date (like "next Thursday", "due tomorrow", "by March 15"), the AI extracts it and sets it on the note.
5. **Priority** -- If the content implies urgency ("URGENT: fix the bug", "ASAP", "someday learn piano"), the AI assigns a priority of urgent, normal, or low.

While the AI is processing, you will see a pulsing placeholder where the type badge and title would normally appear. The note content is immediately visible and usable even before processing finishes.

### Re-analyze

If you edit a note and want the AI to re-classify it, open the note's menu (the three-dot icon) and tap **Re-analyze**. The note's title, tags, type, due date, and priority will be regenerated based on the current content.

---

## Note Types

PocketBrain classifies every note into one of three types:

### NOTE

General-purpose notes. These are observations, information, quotes, reference material -- anything that is not clearly an action item or a creative idea. Notes have no special badge; they appear with just their title and content.

### TASK

Actionable items. Tasks are things you need to do. They are marked with a green **TASK** badge and have a checkbox on the right side of the header. Tasks can have due dates, priority levels, and can be marked complete.

Visual indicators for tasks:
- Green **TASK** badge next to the title.
- Checkbox icon (empty square when incomplete, checked square when complete).
- Colored left border when priority is set (red for urgent, amber for normal, gray for low).
- Due date badge below the title (red "Overdue", amber "Due today", blue "Tomorrow", or gray with the date).

### IDEA

Creative thoughts, concepts, and inspirations. Ideas are marked with an amber **IDEA** badge. They do not have checkboxes or due dates by default, but you can manually add due dates and priorities from the note menu.

---

## Task Management

### Due Dates

Tasks can get due dates in two ways:

**AI-extracted:** When you write something like "schedule meeting for next Tuesday" or "submit report by Friday", the AI automatically detects the date and sets it on the note.

**Manual:** Open the three-dot menu on any note and tap **Set due date**. A date picker appears inline on the note card. Select a date and it is saved immediately. To change an existing due date, choose **Change due date** from the same menu.

To remove a due date, tap the **clear** link that appears next to the due date badge on the note card.

### Due Date Badges

Notes with due dates show a small badge below the title:
- **Overdue** (red) -- the due date has passed.
- **Due today** (amber) -- the due date is today.
- **Tomorrow** (blue) -- the due date is tomorrow.
- **Date** (gray) -- for dates further in the future, the badge shows the formatted date (e.g., "Mar 15").

### Priority Levels

Priority is displayed as a colored left border on the note card:
- **Urgent** -- thick red left border. For items marked ASAP, critical, or urgent.
- **Normal** -- thick amber left border. For standard-priority items.
- **Low** -- thick gray left border. For someday/maybe items.

To set or change priority manually, open the three-dot menu and tap **Set priority**. Three buttons appear: Urgent, Normal, and Low. Tap one to set it, or tap the same one again to remove it. You can also tap **clear** to remove priority entirely.

### Completing Tasks

Tap the checkbox icon on any TASK note to mark it as complete. The note fades slightly, and the title and content get a strikethrough style. Tap the checkbox again to mark it incomplete.

Completing a task is undoable -- see the [Undo](#undo) section.

### Smart Sorting

When you filter your notes to show only Tasks (using the "Tasks" pill filter in the header), notes are automatically sorted by due date. Overdue tasks appear first, followed by tasks due soonest, then tasks with no due date.

---

## Pin and Archive

### Pinning

Pinned notes always appear at the top of your list, regardless of when they were created.

To pin a note, hover over it (or tap it on mobile) and click the **pin icon** that appears in the note header. The pin icon fills in to show the note is pinned. To unpin, click the pin icon again, or open the three-dot menu and tap **Unpin**.

### Archiving

Archiving removes a note from your main view without deleting it. Use it for notes you want to keep but do not need to see regularly.

To archive a note, open the three-dot menu and tap **Archive**. The note disappears from the main view and a toast confirms "Note archived."

### Viewing Archived Notes

To see your archived notes:
1. Open the side drawer (tap the hamburger menu icon in the top right).
2. Tap **Archived**. The badge next to it shows how many archived notes you have.
3. The main view switches to show only archived notes, with a banner at the top: "Viewing archived notes."
4. Tap **Back to notes** in the banner to return to your normal view.

To unarchive a note, open its three-dot menu while viewing archived notes and tap **Unarchive**.

---

## Search

PocketBrain has two search modes, accessible from the search bar at the top of the screen.

### Text Search

By default, search is local text matching. As you type in the search bar, notes are filtered in real time. The search checks:
- Note content
- Note title
- Tags

No need to press Enter -- results update as you type.

### AI Search

Tap the **AI** button on the right side of the search bar to toggle AI search mode. The search bar changes its appearance (violet glow, different placeholder text: "Ask your second brain...").

In AI search mode:
1. Type a question in natural language. For example: "What tasks are overdue?" or "Summarize my ideas about the project."
2. Press **Enter** to submit.
3. A loading animation appears while the AI processes your question.
4. An "Insight" card appears above your notes with the AI's answer.

The AI reads up to your 50 most recent notes and answers based only on their content. If the answer is not in your notes, it will say so.

To exit AI search mode, tap the **AI** button again or press **Escape**.

---

## Tag System

Every note can have tags, either generated by the AI or inherited from batch processing. Tags appear at the bottom of each note card, prefixed with a hash symbol.

### Filtering by Tag

Tap any tag on a note card to filter your view to only notes with that tag. A violet pill appears below the search bar showing the active tag filter (for example, "#productivity"). Tap the X on the pill to clear the filter.

### Tag Cloud in the Drawer

Open the side drawer to see your tags organized in two ways:

**Top Tags:** The five most frequently used tags, listed with their counts. Tap any tag to filter your notes and close the drawer.

**All Tags:** If you have more than five tags, a full tag cloud appears below. Tags are sized by frequency -- heavily used tags appear larger. Tap any tag to filter.

---

## Today View (Daily Briefing)

The Today View is a focused daily dashboard. Tap the **Today** button (calendar icon) in the header to open it.

### What It Shows

The Today View organizes your notes into three sections:

**Overdue:** Tasks with due dates that have already passed. These appear at the top with a red "Overdue" header and a count badge. This section only appears if you have overdue tasks.

**Due Today:** Tasks due today that are not yet completed. Shown with an amber "Due Today" header.

**Captured Today:** All notes created today (regardless of type). Shown with a blue "Captured Today" header.

### AI Daily Brief

At the bottom of the Today View, an **AI Daily Brief** section appears. When you open the Today View, PocketBrain automatically sends your relevant notes to the AI, which generates a 2-3 sentence briefing. It covers overdue items first, then today's priorities, then notable new captures.

While the brief is loading, you will see a pulsing placeholder animation.

If you have no overdue tasks, nothing due today, and no new captures, the Today View shows a clean "All clear for today!" message instead.

### Overdue Dot Indicator

When you have overdue tasks and are not currently in the Today View, a small red dot appears on the Today button in the header. This is your visual reminder that something needs attention.

To exit the Today View, tap the **Today** button again. It works as a toggle.

---

## Dark Mode

PocketBrain supports three theme modes: light, dark, and system.

### Auto-Detection

By default, PocketBrain follows your operating system's theme preference. If your OS is set to dark mode, PocketBrain starts in dark mode automatically. It also responds to changes in real time -- if you switch your OS theme while PocketBrain is open, it updates immediately.

### Manual Toggle

To manually switch between light and dark mode:
1. Open the side drawer (hamburger menu icon in the top right).
2. At the top of the drawer, you will see a toggle showing either "Light Mode" (with a sun icon) or "Dark Mode" (with a moon icon).
3. Tap the toggle to switch. The change applies instantly across the entire app.

When you manually select a theme, that preference is saved in localStorage and persists across sessions. It overrides the system preference until you clear your data.

---

## Undo

PocketBrain keeps an undo stack of your last 10 actions. The following actions can be undone:

- **Delete** -- restores the deleted note.
- **Complete/Uncomplete** -- reverts the task to its previous completion state.
- **Archive** -- restores the note to the main view.

### How to Undo

**Keyboard:** Press **Cmd/Ctrl + Z** when you are not focused in a text input. This undoes the most recent action.

**Toast Button:** When you delete a note, a toast notification appears at the top of the screen with an **Undo** link. Tap it to restore the note. The toast with the undo button stays visible for 5 seconds (normal toasts disappear after 3 seconds).

Each undo pops one action off the stack. You can undo multiple actions in a row, up to 10 deep.

---

## Productivity Stats

Open the side drawer to see your productivity stats at a glance.

### Daily Streak

A flame icon with a number shows how many consecutive days you have captured at least one note. If you miss a day, the streak resets to zero. The streak counts backwards from today (or yesterday, if you have not captured anything today yet).

### Weekly Heatmap

A row of seven colored squares represents Monday through Sunday of the current week. Each square's color intensity reflects how many notes you captured that day:
- Gray: 0 notes
- Light violet: 1-2 notes
- Medium violet: 3-5 notes
- Dark violet: 6+ notes

Hover over a square to see the exact count.

### Today's Activity

Below the heatmap, you will see a line showing how many notes you captured today and (if you have tasks) how many tasks you have completed total.

### Completion Rate

If you have any tasks, a progress bar shows your task completion rate as a percentage. This is calculated across all tasks (not just today's).

### Overview

A grid of four cards shows your total active note count, broken down by type: Total, Notes, Tasks, and Ideas. Archived notes are excluded from these counts.

---

## Import and Export

### Export

Open the side drawer, scroll to "Data Management," and tap **Export**. A dropdown expands with three format options:

**JSON:** Downloads a `pocketbrain_backup.json` file containing all your notes as a JSON array. This is the most complete format and the only one that can be re-imported.

**Markdown:** Downloads a `pocketbrain_export.md` file. Each note is formatted with its title as a heading, the content as body text, and metadata (type, tags, creation date) on a separate line.

**CSV:** Downloads a `pocketbrain_export.csv` file with columns for title, content, type, tags, created date, due date, priority, and completion status. Useful for opening in spreadsheet applications.

### Import

Tap **Import JSON** in the Data Management section of the drawer. A file picker opens -- select a `.json` file.

The import process:
1. Validates the JSON structure. Each note must have `id`, `content`, `createdAt`, and `isProcessed` fields.
2. Deduplicates against your existing notes by ID. Notes with IDs that already exist are skipped.
3. Adds valid notes to your collection.
4. Shows a toast with how many notes were imported. If some items were skipped due to validation errors, a separate toast tells you how many.

If the file is not valid JSON or contains no valid notes, you will see an error toast.

### Clear All Data

At the bottom of the Data Management section, the **Clear All Data** button deletes all notes and clears localStorage. A confirmation dialog appears first. This action cannot be undone.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + K` | Focus the search bar |
| `Cmd/Ctrl + I` | Focus the input text area |
| `Cmd/Ctrl + Enter` | Save the current note (from the input area) |
| `Cmd/Ctrl + Enter` | Save edits (when editing a note inline) |
| `Cmd/Ctrl + Z` | Undo the last action (delete, complete, archive) |
| `Escape` | Close the side drawer |
| `Escape` | Exit AI search mode |
| `Escape` | Blur the currently focused element |
| `Escape` | Cancel inline note editing |

Note: Cmd is used on macOS, Ctrl on Windows and Linux.

---

## Tips and Tricks

**Capture first, organize later.** Do not worry about formatting or categorizing when you capture. Just type and save. The AI handles the rest.

**Use Magic Batch at the end of a meeting.** After a meeting, dump all your notes and action items in one go. The AI will separate tasks from general notes and tag everything for you.

**Pin your active projects.** If you have a few notes you reference constantly, pin them so they always sit at the top of your list.

**Use AI search as a personal assistant.** Instead of scrolling through notes, ask questions: "What did I say about the budget?" or "List my open tasks for this week."

**Archive aggressively.** Done with a note? Archive it instead of deleting it. It stays searchable and exportable but does not clutter your view.

**Check the Today View each morning.** It surfaces overdue tasks, today's priorities, and gives you an AI-generated briefing to start your day.

**Re-analyze after major edits.** If you significantly change a note's content, use the Re-analyze option from the menu to get updated tags, title, and classification.

**Export regularly.** Use JSON export as a backup. If anything goes wrong with localStorage, you have your data.

**Watch for the red dot.** A red dot on the Today button means you have overdue tasks. Do not ignore it.

**Use the tag cloud for discovery.** Open the drawer and browse your tags. You might find patterns in what you capture and think about most.

---

## Troubleshooting

### Voice input is not working

Voice input requires the Web Speech API, which is only available in Chromium-based browsers (Chrome, Edge, Brave, Arc). It is not supported in Firefox or Safari.

If you are using a supported browser and it still does not work:
- Make sure you have granted microphone permissions to the site.
- Check that no other application is using the microphone.
- Try refreshing the page.

If the Voice pill and microphone button do not appear at all, your browser does not support the Web Speech API.

### AI features are not working

AI features (classification, Magic Batch, AI search, daily briefing) require a valid API key. PocketBrain supports two AI providers:

**Option A: Google Gemini (default)**
- Add `GEMINI_API_KEY=your_key_here` to your `.env.local` file.
- Get a key at [Google AI Studio](https://aistudio.google.com/apikey).

**Option B: OpenRouter**
- Add `OPENROUTER_API_KEY=your_key_here` to your `.env.local` file.
- Get a key at [OpenRouter](https://openrouter.ai/keys).
- OpenRouter routes requests to the same `gemini-2.5-flash` model by default, but you can change the model in `services/geminiService.ts` to any OpenRouter-supported model (Claude, GPT-4, Llama, etc.).
- If both keys are present, OpenRouter takes priority.

General troubleshooting:
- Restart the dev server after adding or changing a key (`npm run dev`).
- Check the browser console for error messages. "API Key not found" means no key is being injected.
- Verify your API key is valid with the respective provider.

If AI features fail intermittently, it may be a rate limit or network issue. Notes are still saved locally even when AI processing fails -- they just will not get auto-titles and tags.

### Storage full warning

PocketBrain stores all data in browser localStorage, which is typically limited to 5-10 MB depending on the browser. If you see a "Storage full" warning:
- Export your data as JSON first (as a backup).
- Archive or delete notes you no longer need.
- Clear old data from other sites using your browser's storage settings.

### Notes show "Processing..." indefinitely

This usually means the AI analysis failed silently. The note itself is saved; it just did not get classified.

- Check your internet connection.
- Verify your API key is set correctly.
- Open the note's three-dot menu and tap **Re-analyze** to retry.

### Offline behavior

When you lose internet connectivity, a yellow banner appears at the top: "Offline -- notes saved locally." You can continue capturing notes normally. AI features (classification, search, batch, daily brief) will not work until you reconnect, but all captures are safely stored in localStorage.

### Data disappeared after clearing browser data

PocketBrain stores everything in localStorage. If you clear your browser's site data, storage, or cookies, your notes are permanently deleted. To protect against this, use the JSON export feature regularly as a backup. You can re-import the JSON file at any time to restore your notes.
