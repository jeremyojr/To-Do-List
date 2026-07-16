# Finisher

A cross-platform to-do list built around a **2×2 Urgency × Age matrix**. Tasks
automatically drift across the age axis as days pass — the app makes the cost
of procrastination visible.

**No build step, no backend.** It's plain HTML/CSS/JS — open `index.html` in
any browser, or host the folder on any static host (GitHub Pages works great).

## The matrix

|                | **New**                   | **Old**                          |
| -------------- | ------------------------- | -------------------------------- |
| **High urgency** | 🔥 Important · New — just landed | 🚨 Important · Aging — pulses red, do first |
| **Low urgency**  | 🌱 Regular · New — no rush      | 🪨 Regular · Aging — finish or drop      |

- **Y-axis (urgency)** is chosen by you per task (Low / High), editable any time.
- **X-axis (age)** is computed: a task crosses from *New* to *Old* once it is
  older than the threshold (default **3 days**, configurable in the top bar).
- Within a quadrant, the oldest task sits on top.

## Features

- **Work / Home context switcher** — two fully separate task lists, one toggle.
- **Capped quadrants** — each quadrant shows at most 8 tasks. When there are
  more, a "+N more" bar appears; tap it (or the quadrant header) to expand to
  the full list, tap again to collapse. The header badge always shows the true
  count.
- **Compact, tappable cards** — tasks with attached images or long text render
  compact (2-line clamp, a `📷 n` chip). Tap the card to expand it and see the
  full text and image thumbnails; tap again to collapse. Buttons on the card
  (complete, edit, delete, thumbnails) never trigger the toggle.
- **Paste images** — copy any image and paste it into the composer (or into a
  task's edit dialog) to attach it. Images are downscaled to ≤1024px JPEG
  before storage to respect the localStorage budget. Click a thumbnail for a
  full-size lightbox.
- **Complete / reinstate / delete** — the ✓ ring crosses a task off and moves
  it to the Archive drawer, where it can be reinstated, deleted individually,
  or cleared in bulk (per context).
- **Responsive** — full 2×2 matrix on laptop/tablet; on phones the quadrants
  stack in priority order (Important·Aging first).
- **Persistence** — everything lives in `localStorage` under one key
  (`matrixTodo.v1`); nothing leaves your browser.

## How the aging timer works

A task's quadrant is **derived, never stored** — only `createdAt` is saved, so
"moving" a task across the age axis is just a re-render. Three layers keep the
view honest:

1. **Midnight tick** — a `setTimeout` aimed at the next local midnight (the
   only moment a calendar-day age can change) re-renders and re-arms itself.
2. **Drift watchdog** — a 60-second interval fingerprints every task's
   quadrant + age label and re-renders only if something changed (covers
   system clock changes and missed timeouts).
3. **Wake-up hook** — mobile browsers freeze timers in background tabs, so a
   `visibilitychange` listener re-checks the fingerprint the moment the tab
   comes back.

Ages are calendar-day based (`floor(startOfToday − startOfCreatedDay)`), so a
task created at 11:59 PM is "1 day old" two minutes later — matching how
people actually think about "yesterday's task."

## Architecture

```
index.html    markup: topbar, composer, matrix, archive drawer, edit modal, lightbox
styles.css    theme variables (light + dark), matrix grid, pulse animation, breakpoints
app.js
 ├─ Store     localStorage persistence, task CRUD, settings
 ├─ Age       calendar-day math, quadrant derivation, the three timers
 ├─ Images    clipboard capture → canvas downscale → JPEG data URL
 └─ UI        pure-DOM rendering + event wiring (re-renders from state)
```

Task shape:

```js
{ id, text, context: 'work'|'home', urgency: 'high'|'low',
  createdAt, completedAt|null, images: [dataURL…] }
```

## A note on cross-device sync

`localStorage` is per-browser-per-device: your phone, tablet, and PC each keep
their own copy. The UI is fully consistent across all of them, but tasks
entered on one device won't appear on another without a sync layer. The clean
upgrade path is to swap the `Store` module for a small backend or a service
like Firebase/Supabase — every other module only talks to `Store`, so nothing
else needs to change.
