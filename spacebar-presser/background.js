// Service worker: coordinates which tabs are "armed", injects the scripts on
// demand, and re-arms a tab after it reloads/navigates.
"use strict";

const KEY = "targets"; // { [tabId]: { running, min, max, mode, gap } } in session storage

async function getTargets() {
  const o = await chrome.storage.session.get(KEY);
  return o[KEY] || {};
}
async function setTargets(t) {
  await chrome.storage.session.set({ [KEY]: t });
}

async function ensureInjected(tabId) {
  // MAIN-world helper first (it dispatches the real key events), then the
  // isolated-world controller that talks to us and runs the loop.
  await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["inpage.js"] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
}

async function startTab(tabId, opts) {
  const cfg = { running: true, min: opts.min, max: opts.max, mode: opts.mode, gap: opts.gap };
  const targets = await getTargets();
  targets[tabId] = cfg;
  await setTargets(targets);
  await ensureInjected(tabId);
  await chrome.tabs.sendMessage(tabId, {
    type: "SBP_START", min: cfg.min, max: cfg.max, mode: cfg.mode, gap: cfg.gap
  });
}

async function stopTab(tabId) {
  const targets = await getTargets();
  delete targets[tabId];
  await setTargets(targets);
  try {
    await chrome.tabs.sendMessage(tabId, { type: "SBP_STOP" });
  } catch (e) {
    // content script may be gone (tab closed/navigated) — nothing to stop.
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.cmd === "start") {
        await startTab(msg.tabId, msg);
        sendResponse({ ok: true });
      } else if (msg.cmd === "stop") {
        await stopTab(msg.tabId);
        sendResponse({ ok: true });
      } else if (msg.cmd === "status") {
        const targets = await getTargets();
        const wanted = !!(targets[msg.tabId] && targets[msg.tabId].running);
        let live = null;
        try {
          live = await chrome.tabs.sendMessage(msg.tabId, { type: "SBP_STATUS" });
        } catch (e) {
          live = null; // no content script yet / restricted page
        }
        sendResponse({ ok: true, wanted, live });
      } else {
        sendResponse({ ok: false, error: "unknown command" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String((e && e.message) || e) });
    }
  })();
  return true; // async response
});

// Re-arm a tab after it finishes (re)loading, so the loop survives reloads and
// in-page navigations while the tab sits in the background.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== "complete") return;
  const targets = await getTargets();
  const t = targets[tabId];
  if (!t || !t.running) return;
  try {
    await ensureInjected(tabId);
    await chrome.tabs.sendMessage(tabId, {
      type: "SBP_START", min: t.min, max: t.max, mode: t.mode, gap: t.gap
    });
  } catch (e) {
    // Some pages can't be injected (e.g. navigated to chrome://). Leave the
    // target recorded; if they navigate back to a normal page it resumes.
  }
});

// Forget tabs that go away.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const targets = await getTargets();
  if (targets[tabId]) {
    delete targets[tabId];
    await setTargets(targets);
  }
});
