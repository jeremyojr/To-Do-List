"use strict";

var RING_R = 66;
var RING_LEN = 2 * Math.PI * RING_R;

var el = {
  target: document.getElementById("target"),
  ring: document.getElementById("ring"),
  countdown: document.getElementById("countdown"),
  stateLabel: document.getElementById("stateLabel"),
  toggle: document.getElementById("toggle"),
  note: document.getElementById("note"),
  seg: document.getElementById("seg"),
  segBtns: Array.prototype.slice.call(document.querySelectorAll("#seg button")),
  min: document.getElementById("minInput"),
  max: document.getElementById("maxInput"),
  gapRow: document.getElementById("gapRow"),
  gap: document.getElementById("gapInput"),
  pressCount: document.getElementById("pressCount"),
  nextWait: document.getElementById("nextWait"),
  foot: document.getElementById("foot")
};

var tab = null;
var restricted = false;
var mode = "single";
var pollTimer = null;

function hostOf(url) {
  try { return new URL(url).hostname || url; } catch (e) { return url || ""; }
}

function isRestricted(url) {
  if (!url) return true;
  if (/^(chrome|edge|brave|opera|vivaldi|about|chrome-extension|moz-extension|devtools|view-source|data|file):/i.test(url)) return true;
  if (/^https?:\/\/chromewebstore\.google\.com/i.test(url)) return true;
  if (/^https?:\/\/chrome\.google\.com\/webstore/i.test(url)) return true;
  return false;
}

function getConfig() {
  var min = Math.floor(Number(el.min.value));
  var max = Math.floor(Number(el.max.value));
  var gap = Math.floor(Number(el.gap.value));
  var ok = true, msg = "";
  if (!isFinite(min) || min < 1) { ok = false; msg = "Minimum must be at least 1 second."; }
  else if (!isFinite(max) || max < 1) { ok = false; msg = "Maximum must be at least 1 second."; }
  else if (max < min) { ok = false; msg = "Maximum must be ≥ minimum."; }
  else if (mode === "pair" && (!isFinite(gap) || gap < 1)) { ok = false; msg = "Second-press delay must be at least 1 second."; }
  return { min: min, max: max, gap: gap, mode: mode, ok: ok, msg: msg };
}

function showNote(msg, isError) {
  el.note.textContent = msg || "";
  el.note.classList.toggle("error", !!isError);
}

function setRing(frac) {
  el.ring.style.strokeDashoffset = (RING_LEN * (1 - frac)).toFixed(2);
}

function applyMode(m) {
  mode = m === "pair" ? "pair" : "single";
  el.segBtns.forEach(function (b) { b.classList.toggle("active", b.dataset.mode === mode); });
  el.gapRow.hidden = mode !== "pair";
  el.foot.textContent = mode === "pair"
    ? "Musical chairs: random wait, press, then a second press after the delay below — then it re-randomizes and repeats."
    : "Each interval is re-randomized (cryptographically) in your range. Runs on the tab shown above, even in the background.";
}

async function getStatus() {
  try {
    var res = await chrome.runtime.sendMessage({ cmd: "status", tabId: tab.id });
    return res || {};
  } catch (e) {
    return {};
  }
}

async function onToggle() {
  var res = await getStatus();
  var running = !!(res.wanted || (res.live && res.live.running));
  if (running) {
    await chrome.runtime.sendMessage({ cmd: "stop", tabId: tab.id });
    showNote("");
  } else {
    var c = getConfig();
    if (!c.ok) { showNote(c.msg, true); return; }
    var out = await chrome.runtime.sendMessage({
      cmd: "start", tabId: tab.id, min: c.min, max: c.max, gap: c.gap, mode: c.mode
    });
    if (!out || !out.ok) {
      showNote("Couldn't start on this page. " + ((out && out.error) || "Try a normal website tab."), true);
      return;
    }
    showNote("");
  }
  await updateUI();
}

function saveSettings() {
  chrome.storage.local.set({ min: el.min.value, max: el.max.value, gap: el.gap.value, mode: mode });
}

function onSettings() {
  saveSettings();
  updateUI();
}

function onMode(e) {
  var btn = e.target.closest("button[data-mode]");
  if (!btn || btn.disabled) return;
  applyMode(btn.dataset.mode);
  saveSettings();
  updateUI();
}

async function updateUI() {
  if (restricted) return;
  var res = await getStatus();
  var live = res.live;
  var running = !!(res.wanted || (live && live.running));

  el.toggle.textContent = running ? "Stop" : "Start";
  el.toggle.classList.toggle("stop", running);
  el.min.disabled = running;
  el.max.disabled = running;
  el.gap.disabled = running;
  el.segBtns.forEach(function (b) { b.disabled = running; });

  var phaseLabel = "Running";
  if (running && live && live.running) {
    phaseLabel = live.phase === "gap" ? "2nd press" : (mode === "pair" ? "Waiting" : "Running");
  } else if (!running) {
    phaseLabel = "Idle";
  }
  el.stateLabel.textContent = phaseLabel;

  if (live && live.running && live.waitMs > 0) {
    var remaining = Math.max(0, live.remainingMs);
    el.countdown.innerHTML = Math.ceil(remaining / 1000) + "<small>s</small>";
    setRing(remaining / live.waitMs);
    el.nextWait.textContent = (live.waitMs / 1000).toFixed(0) + "s";
    el.ring.classList.toggle("gap", live.phase === "gap");
  } else {
    el.countdown.innerHTML = "—<small>s</small>";
    setRing(1);
    el.nextWait.textContent = running ? "…" : "—";
    el.ring.classList.remove("gap");
  }
  if (live) el.pressCount.textContent = live.presses;

  if (!running) {
    var c = getConfig();
    el.toggle.disabled = !c.ok;
    showNote(c.ok ? "" : c.msg, !c.ok);
  } else {
    el.toggle.disabled = false;
  }
}

async function init() {
  el.ring.style.strokeDasharray = RING_LEN.toFixed(2);
  setRing(1);

  var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  tab = tabs[0];

  var saved = await chrome.storage.local.get(["min", "max", "gap", "mode"]);
  if (saved.min) el.min.value = saved.min;
  if (saved.max) el.max.value = saved.max;
  if (saved.gap) el.gap.value = saved.gap;
  applyMode(saved.mode || "single");

  if (!tab || isRestricted(tab.url)) {
    restricted = true;
    el.target.textContent = "Can't run on this page";
    el.toggle.disabled = true;
    el.min.disabled = true;
    el.max.disabled = true;
    el.gap.disabled = true;
    el.segBtns.forEach(function (b) { b.disabled = true; });
    showNote("Open a normal website tab (http/https), then reopen this popup.", true);
    return;
  }

  el.target.textContent = hostOf(tab.url);
  el.target.title = tab.title || tab.url;

  el.toggle.addEventListener("click", onToggle);
  el.seg.addEventListener("click", onMode);
  el.min.addEventListener("input", onSettings);
  el.max.addEventListener("input", onSettings);
  el.gap.addEventListener("input", onSettings);

  await updateUI();
  pollTimer = setInterval(updateUI, 250);
}

document.addEventListener("DOMContentLoaded", init);
