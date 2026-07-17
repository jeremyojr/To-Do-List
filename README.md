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
- **Rich-text details** — the ▾ arrow in the composer opens a details box
  contiguous with the title field, where Enter starts a new paragraph and
  formatting pasted from other sites
  (bullets, numbering, bold, links) transposes intact. Details are stored as
  sanitized HTML (small tag whitelist, all attributes stripped, unsafe links
  neutralized — at paste time and again at render). On the grid, details stay
  hidden until you tap the task; search looks inside them too.
- **Compact, tappable cards** — tasks with attached images, details, or long
  text render compact (2-line clamp, `📷 n` chip, ▾ arrow button). Tap the
  card or its arrow to expand it and see the full text, details, and image
  thumbnails; tap again to collapse. Buttons, links, and the details block (kept selectable for
  copying) never trigger the toggle.
- **Clickable links** — any URL in a task's text (https://… or www.…) becomes
  a tappable link that opens in a new tab; tapping a link never toggles the
  card's expand/collapse.
- **Paste images** — copy any image and paste it into the composer (or into a
  task's edit dialog) to attach it. Images are downscaled to ≤1024px JPEG
  before storage to respect the localStorage budget. Click a thumbnail for a
  full-size lightbox.
- **Filter & boolean search** — a compact search box plus a collapsed
  **📅 Filter** button (expands to exact-date / month / year controls; an
  entry matches if it was created or completed in that period) filter the
  matrix and the Archive drawer together. Search supports `"exact phrases"`,
  implicit AND between terms, uppercase `OR`, and `NOT` before a word or
  phrase, all case-insensitive — e.g. `report OR "design mock" NOT draft`.
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
{ id, text, details: sanitizedHTML, context: 'work'|'home',
  urgency: 'high'|'low', createdAt, completedAt|null,
  updatedAt, images: [dataURL…] }
```

## Cross-device sync (Google Drive)

Tasks live in `localStorage` per device, and can optionally sync across all
your devices through a private file in **your own Google Drive** (the hidden
`appDataFolder` — the app can only ever see its own file, never the rest of
your Drive). Merging is per task, newest edit wins; deletions propagate via
tombstones; the app stays fully usable offline and reconciles when back
online. Devices sync on open, when the tab regains focus, ~2.5s after any
edit, and every 2 minutes.

### One-time setup (free)

1. Go to [console.cloud.google.com](https://console.cloud.google.com) →
   create a project (call it `Finisher`).
2. **APIs & Services → Library** → search "Google Drive API" → **Enable**.
3. **APIs & Services → OAuth consent screen** → External → fill in the app
   name and your email → save. Under **Test users**, add your own Gmail
   address.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID** →
   type **Web application** → under *Authorized JavaScript origins* add the
   origin the app is served from (e.g. `https://<you>.github.io`), and under
   *Authorized redirect URIs* add the app's full URL (e.g.
   `https://<you>.github.io/To-Do-List/`) → Create → copy the **Client ID**.
5. In the app, tap **☁ Sync**, paste the Client ID, and **Connect Google
   Drive**. Repeat the connect step (sign-in only) once on each device —
   after that each device reconnects automatically: the ~1h token is
   remembered locally and silently renewed with a `prompt=none` redirect
   bounce on load / tab focus.
6. Recommended: on the OAuth consent screen, click **Publish app** (status
   "In production"). Otherwise Google's testing mode expires the grant every
   7 days and you'd have to re-consent weekly.

The Client ID is not a secret — it only works from the origins you authorized.
It can also be hardcoded as `DEFAULT_CLIENT_ID` in `app.js` so devices never
need the paste step.
