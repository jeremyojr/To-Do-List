// Runs in the page's MAIN world (injected by background.js). The content
// script can't build a keyboard event with a working legacy keyCode/which and
// have the page see it — those props are stripped crossing the isolated/main
// world boundary. So the content script just fires a lightweight "__sbp_fire"
// DOM event, and this main-world helper creates and dispatches the real Space
// key events right where the page's own listeners live.
(function () {
  "use strict";
  if (window.__sbpInpage) return;
  window.__sbpInpage = true;

  function makeKeyEvent(type) {
    var ev = new KeyboardEvent(type, {
      key: " ",
      code: "Space",
      location: 0,
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window
    });
    // Force legacy numeric props (many handlers still read keyCode/which).
    // Done in the MAIN world so the page's listeners actually see 32.
    var legacy = { keyCode: 32, which: 32, charCode: type === "keypress" ? 32 : 0 };
    Object.keys(legacy).forEach(function (p) {
      try {
        Object.defineProperty(ev, p, { get: (function (v) { return function () { return v; }; })(legacy[p]) });
      } catch (e) { /* locked in some engines; key/code still work */ }
    });
    return ev;
  }

  function pressSpace() {
    var t = document.activeElement || document.body || document.documentElement;
    if (!t) return;
    t.dispatchEvent(makeKeyEvent("keydown"));
    t.dispatchEvent(makeKeyEvent("keypress"));
    t.dispatchEvent(makeKeyEvent("keyup"));
  }

  window.addEventListener("__sbp_fire", pressSpace, false);
})();
