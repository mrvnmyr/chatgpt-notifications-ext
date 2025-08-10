(() => {
  "use strict";

  // Target from your spec:
  const XPATH =
    "//div[@data-testid='composer-trailing-actions']//button[@id='composer-submit-button' or @data-testid='composer-speech-button']";

  // Attributes that indicate meaningful changes
  const OBS_ATTRS = ["aria-label", "class", "disabled", "title"];

  // Track observed buttons: Element -> { observer, timer, kind }
  const observed = new Map();
  // Track last label we actually notified for, per button "kind"
  // kind = "submit" | "speech" | "unknown"
  const lastNotifiedByKind = new Map();

  // --- Debug helpers ----------------------------------------------------
  const DBG = (...args) => console.log("[CGPT Notifier]", ...args);
  const DBG_ERR = (...args) => console.warn("[CGPT Notifier:warn]", ...args);

  function xAll(xpath, root = document) {
    const snap = document.evaluate(
      xpath,
      root,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null
    );
    const out = [];
    for (let i = 0; i < snap.snapshotLength; i++) out.push(snap.snapshotItem(i));
    return out;
  }

  function btnKind(btn) {
    if (btn?.id === "composer-submit-button") return "submit";
    const dt = btn?.getAttribute("data-testid") || "";
    if (dt === "composer-speech-button") return "speech";
    return "unknown";
  }

  async function ensureNotifPermission() {
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    try {
      const status = await Notification.requestPermission();
      return status === "granted";
    } catch (e) {
      DBG_ERR("requestPermission failed:", e);
      return false;
    }
  }

  async function notifyWithLabel(label) {
    const body = (label && String(label).trim()) || "Composer button changed";
    const ok = await ensureNotifPermission();
    if (ok) {
      try {
        new Notification("ChatGPT Button Changed", { body });
        DBG("Notification shown:", body);
      } catch (e) {
        // Some environments disallow direct constructor; fall back to console.
        DBG_ERR("Notification() failed, logging instead:", e);
        console.log("[ChatGPT Notifier]", body);
      }
    } else {
      // No permission—don’t spam alerts; just log.
      DBG("No notification permission. Would have shown:", body);
    }
  }

  function scheduleNotify(el, label, kind) {
    const rec = observed.get(el);
    if (!rec) return;

    // Deduplicate across multiple instances of the same "kind"
    if (label) {
      const last = lastNotifiedByKind.get(kind);
      if (last === label) {
        DBG("Deduped (same label) for kind:", kind, "label:", label);
      } else {
        lastNotifiedByKind.set(kind, label);
      }
    }

    clearTimeout(rec.timer);
    rec.timer = setTimeout(() => notifyWithLabel(label), 150);
  }

  function maybeInitialNotify(btn, kind) {
    // Fire once on attach if this "kind" has not been notified yet
    // OR if the current label differs from the last notified for that kind.
    const label = btn.getAttribute("aria-label") || "";
    const last = lastNotifiedByKind.get(kind);
    if (label && label !== last) {
      DBG("Initial notify on attach. kind:", kind, "label:", label);
      // Update before scheduling to avoid duplicate notifications from rapid rescans
      lastNotifiedByKind.set(kind, label);
      const rec = observed.get(btn);
      if (rec) {
        clearTimeout(rec.timer);
        rec.timer = setTimeout(() => notifyWithLabel(label), 50);
      } else {
        // Shouldn't happen, but just in case:
        notifyWithLabel(label);
      }
    } else {
      DBG("Skip initial notify (same as last or empty). kind:", kind, "label:", label);
    }
  }

  function observeButton(btn) {
    if (!btn || observed.has(btn)) return;

    const kind = btnKind(btn);
    const rec = { observer: null, timer: null, kind };
    observed.set(btn, rec);

    const currentLabel = btn.getAttribute("aria-label") || "";
    DBG("Observing button:", { kind, label: currentLabel, node: btn });

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
      DBG("Mutation detected. kind:", kind, "new label:", label, "mutations:", mutations);
      // Notify on any relevant change (even if label stays same for this node),
      // but dedupe per-kind via lastNotifiedByKind.
      scheduleNotify(btn, label, kind);
    });

    rec.observer.observe(btn, {
      attributes: true,
      attributeFilter: OBS_ATTRS,
      childList: true,
      subtree: true,
    });

    // NEW: Fire an "initial" notification on attach so we also capture states
    // that appear by (re)creation rather than attribute mutation (e.g. speech button).
    maybeInitialNotify(btn, kind);
  }

  function cleanupDisconnected() {
    for (const [el, rec] of Array.from(observed.entries())) {
      if (!el.isConnected) {
        try {
          rec.observer && rec.observer.disconnect();
        } catch (e) {
          DBG_ERR("observer.disconnect error:", e);
        }
        clearTimeout(rec.timer);
        observed.delete(el);
        DBG("Cleaned up disconnected button. kind:", rec.kind);
      }
    }
  }

  let rescanScheduled = false;
  function scheduleRescan(why = "mutation") {
    if (rescanScheduled) return;
    rescanScheduled = true;
    queueMicrotask(() => {
      rescanScheduled = false;
      scanAndAttach(why);
    });
  }

  function scanAndAttach(why = "manual") {
    cleanupDisconnected();
    const matches = xAll(XPATH);
    DBG(`Scan (${why}) found ${matches.length} match(es).`);
    for (const btn of matches) observeButton(btn);
  }

  function start() {
    DBG("Content script loaded. Starting observers…");

    // Initial pass
    scanAndAttach("initial");

    // Watch the whole document for dynamic UI changes (button recreate, etc.)
    const docObserver = new MutationObserver((mutationList) => {
      // Cheap heuristic: only rescan when nodes are added/removed near our target area,
      // but since chat UI is highly dynamic, we just rescan on any childList change.
      for (const m of mutationList) {
        if (m.type === "childList") {
          scheduleRescan("doc-childList");
          break;
        }
      }
    });
    const root = document.documentElement || document;
    docObserver.observe(root, {
      childList: true,
      subtree: true,
    });

    // Fallback periodic scan in case something slips past (cheap, but reliable)
    setInterval(() => scanAndAttach("interval"), 3000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
