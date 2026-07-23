// Injected into the target tab's ISOLATED world (it needs chrome.runtime).
// Runs the timing loop and asks the MAIN-world helper (inpage.js) to dispatch
// the actual Space key events. Idempotent: re-injecting after a reload or a
// second Start must not stack listeners or timers.
(function () {
  "use strict";

  if (window.__sbpInstalled) {
    // Already set up in this document; the live listener below handles messages.
    return;
  }
  window.__sbpInstalled = true;

  var running = false;
  var timer = null;
  var fireAt = 0;       // Date.now() ms when the next press fires
  var currentWait = 0;  // ms of the wait currently counting down
  var presses = 0;
  var phase = "idle";   // "wait" (random) | "gap" (fixed 2nd press) | "idle"

  // Mode + settings, set on START.
  var mode = "single";  // "single" | "pair"
  var gMin = 20, gMax = 60, gGap = 5;

  // --- Cryptographic randomness -------------------------------------------
  // A fresh, independent, uniform value in [0, 1) for every interval, from the
  // CSPRNG rather than Math.random().
  function rand01() {
    try {
      var a = new Uint32Array(1);
      crypto.getRandomValues(a);
      return a[0] / 4294967296; // 2^32
    } catch (e) {
      return Math.random(); // extremely defensive fallback
    }
  }

  function fire() {
    // Hand off to the MAIN world (see inpage.js) to dispatch the real key events.
    window.dispatchEvent(new CustomEvent("__sbp_fire"));
    presses++;
  }

  function arm(ms, ph, cb) {
    currentWait = ms;
    fireAt = Date.now() + ms;
    phase = ph;
    clearTimeout(timer);
    timer = setTimeout(cb, ms);
  }

  // One cycle:
  //   single: [random wait] -> press -> repeat
  //   pair  : [random wait] -> press -> [fixed gap] -> press -> repeat
  function cycle() {
    var wait = (gMin + rand01() * (gMax - gMin)) * 1000; // fresh random each time
    arm(wait, "wait", function () {
      fire();
      if (!running) return;
      if (mode === "pair") {
        arm(gGap * 1000, "gap", function () {
          fire();
          if (running) cycle();
        });
      } else {
        cycle();
      }
    });
  }

  function start(opts) {
    mode = opts.mode === "pair" ? "pair" : "single";
    gMin = Number(opts.min);
    gMax = Number(opts.max);
    gGap = Number(opts.gap) > 0 ? Number(opts.gap) : 5;
    if (!(gMin >= 1) || !(gMax >= gMin)) return; // guard bad input
    running = true;
    cycle();
  }

  function stop() {
    running = false;
    clearTimeout(timer);
    timer = null;
    fireAt = 0;
    currentWait = 0;
    phase = "idle";
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || !msg.type) return;
    if (msg.type === "SBP_START") {
      start(msg);
      sendResponse({ ok: true });
    } else if (msg.type === "SBP_STOP") {
      stop();
      sendResponse({ ok: true });
    } else if (msg.type === "SBP_STATUS") {
      sendResponse({
        ok: true,
        running: running,
        remainingMs: running ? Math.max(0, fireAt - Date.now()) : 0,
        waitMs: currentWait,
        presses: presses,
        phase: phase,
        mode: mode
      });
    }
    return true; // keep the channel open for the synchronous sendResponse
  });
})();
