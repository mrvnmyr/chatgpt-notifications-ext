(() => {
  "use strict";

  // Target from your spec:
  const XPATH =
    "//div[@data-testid='composer-trailing-actions']//button[@id='composer-submit-button' or @data-testid='composer-speech-button']";

  // Attributes that indicate meaningful changes
  const OBS_ATTRS = ["aria-label", "class", "disabled", "title"];

  // Track observed buttons: Element -> { observer, timer }
  const observed = new Map();

  function xAll(xpath, root = document) {
    const snap = document.evaluate(
      xpath,
      root,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null
    );
    const out = [];
    for (let i = 0; i < snap.snapshotLength; i++)
      out.push(snap.snapshotItem(i));
    return out;
  }

  async function ensureNotifPermission() {
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    try {
      const status = await Notification.requestPermission();
      return status === "granted";
    } catch {
      return false;
    }
  }

  async function notifyWithLabel(label) {
    const ok = await ensureNotifPermission();
    const body = (label && String(label).trim()) || "Composer button changed";
    if (ok) {
      try {
        new Notification("ChatGPT Button Changed", { body });
      } catch (e) {
        // Some environments disallow direct constructor; fall back to console.
        console.log("[ChatGPT Notifier]", body);
      }
    } else {
      // No permission—don’t spam alerts; just log.
      console.log("[ChatGPT Notifier] (no notification permission):", body);
    }
  }

  function scheduleNotify(el, label) {
    const rec = observed.get(el);
    if (!rec) return;
    clearTimeout(rec.timer);
    rec.timer = setTimeout(() => notifyWithLabel(label), 150);
  }

  function observeButton(btn) {
    if (!btn || observed.has(btn)) return;

    const rec = { observer: null, timer: null };
    observed.set(btn, rec);

    rec.observer = new MutationObserver((mutations) => {
      let relevant = false;
      for (const m of mutations) {
        if (m.type === "attributes") {
          if (OBS_ATTRS.includes(m.attributeName)) {
            relevant = true;
            break;
          }
        } else if (m.type === "childList") {
          relevant = true;
          break;
        }
      }
      if (!relevant) return;

      const label = btn.getAttribute("aria-label") || "";
      scheduleNotify(btn, label);
    });

    rec.observer.observe(btn, {
      attributes: true,
      attributeFilter: OBS_ATTRS,
      childList: true,
      subtree: true,
    });
  }

  function cleanupDisconnected() {
    for (const [el, rec] of Array.from(observed.entries())) {
      if (!el.isConnected) {
        try {
          rec.observer && rec.observer.disconnect();
        } catch {}
        clearTimeout(rec.timer);
        observed.delete(el);
      }
    }
  }

  function scanAndAttach() {
    cleanupDisconnected();
    const matches = xAll(XPATH);
    for (const btn of matches) {
      observeButton(btn);
    }
  }

  function start() {
    // Initial pass
    scanAndAttach();

    // Watch the whole document for dynamic UI changes (button recreate, etc.)
    const docObserver = new MutationObserver(() => {
      scanAndAttach();
    });
    docObserver.observe(document.documentElement || document, {
      childList: true,
      subtree: true,
    });

    // Fallback periodic scan in case something slips past (cheap, but reliable)
    setInterval(scanAndAttach, 3000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
