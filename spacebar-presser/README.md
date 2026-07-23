# ⎵ Auto Spacebar Presser (Chrome extension)

A tiny, local Chrome extension that presses the **spacebar once** at a **fresh random interval** (default **20–60 seconds**) in the tab you choose — and keeps going even when that tab is in the background.

No account, no network, nothing published. It's an *unpacked* extension you load from this folder.

---

## Install (Load unpacked)

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked**.
4. Select this `spacebar-presser` folder.
5. Pin it (puzzle-piece icon → pin) so the ⎵ button is always visible.

## Use

1. Go to the tab you want to keep pressing.
2. Click the **⎵ Spacebar Presser** toolbar button.
3. Pick a **mode** (see below), adjust the seconds — these persist.
4. Click **Start**. The dial counts down to the next press; **Stop** ends it.

It runs on the specific tab that was active when you hit Start, and keeps
pressing that tab in the background. If the tab reloads or navigates, the
extension automatically re-arms it. Closing the tab stops it.

## Modes

- **Single press** — wait a random interval in your `[Min, Max]` range, press
  Space once, then re-randomize and repeat.
- **Musical chairs** — wait a random interval, press Space, then press Space
  again after a fixed delay (**default 5s**, adjustable), then re-randomize and
  repeat. Handy when one press "stops the music" and the paired press a few
  seconds later "starts" it again. The dial turns amber while it's counting
  down to that second press.

## How the randomness works

The requirement was that the timing be genuinely random, so every interval is
**re-sampled independently** — it is *not* a fixed delay and *not* `Math.random()`.
Each wait is drawn from the browser's cryptographic RNG
(`crypto.getRandomValues`) and mapped uniformly onto your `[min, max]` range:

```js
wait = min + rand01() * (max - min)   // rand01() from crypto.getRandomValues
```

So press #1 might be 41.7s later, press #2 22.3s, press #3 58.9s, and so on —
each gap fresh and unpredictable within the range.

## What "presses the spacebar" means here — and its limits

The extension dispatches a real `keydown` → `keypress` → `keyup` sequence for
**Space** (`key: " "`, `code: "Space"`, plus legacy `keyCode/which = 32`) into
the page. This reaches any JavaScript on the page that listens for key events
(`addEventListener("keydown", …)` etc.).

> Implementation note: the key events are dispatched from the page's **MAIN
> world** (via `inpage.js`), not the content script's isolated world. This is
> deliberate — a `keyCode`/`which` value set in the isolated world gets stripped
> crossing into the page, so legacy handlers would see `keyCode: 0`. Dispatching
> in the main world makes the page see the real `32`.

Because these are script-generated events, the browser marks them
`isTrusted: false`. That means:

- ✅ Works for pages/apps that handle the spacebar in their own JS
  (many web games, players, editors, "press space to continue" widgets,
  idle/keep-awake use).
- ❌ Does **not** trigger the browser's own default actions (e.g. it won't
  scroll the page or play/pause native `<video>` via the built-in shortcut).
- ❌ Some games/apps deliberately ignore untrusted events (especially ones
  using Pointer Lock or checking `event.isTrusted`) and won't respond.
- ❌ Can't run on Chrome's own pages (`chrome://`, the Web Store, other
  extensions' pages, the PDF viewer). The popup will tell you when the
  current tab is off-limits.

If you need OS-level, fully "trusted" keypresses that work in *any*
application (not just a web page), that requires a native automation tool
(AutoHotkey on Windows, `xdotool`/`ydotool` on Linux, Karabiner/AppleScript on
macOS) rather than a browser extension — the browser sandbox can't produce
those.

## Permissions, and why

- `scripting` + `host_permissions: <all_urls>` — to inject the presser into the
  tab you pick and to re-arm it after a reload while it's in the background.
- `tabs` — to read the current tab's title/URL for the popup and to detect
  reloads.
- `storage` — to remember your Min/Max and which tab is armed (kept in
  `session` storage, cleared when Chrome closes).

Everything runs locally in your browser. Nothing is sent anywhere.

## Files

| File | Role |
|------|------|
| `manifest.json` | Extension manifest (Manifest V3) |
| `popup.html` / `popup.css` / `popup.js` | The control panel (Start/Stop, range, countdown) |
| `content.js` | Injected (isolated world); runs the random loop and drives presses |
| `inpage.js` | Injected (MAIN world); dispatches the real Space key events into the page |
| `background.js` | Service worker; injects the scripts and re-arms on reload |
| `icons/` | Toolbar icons |

## Timing note

Chrome throttles JavaScript timers in **hidden** tabs (and more aggressively
after a tab has been hidden for several minutes). Intervals up to ~60s stay
close to accurate, but for the tightest timing keep the target tab visible.
