(() => {
  "use strict";

  // Target from your spec:
  const XPATH =
    "//div[@data-testid='composer-trailing-actions']//button[@id='composer-submit-button' or @data-testid='composer-speech-button']";

  // Attributes that indicate meaningful changes (expanded for visibility toggles)
  const OBS_ATTRS = [
    "aria-label",
    "class",
    "disabled",
    "title",
    "style",
    "aria-hidden",
    "hidden",
  ];

  // Re-notify timeout for identical labels (ms)
  const RESURGE_MS = 1500;

  // Track observed buttons: Element -> { observer, io, timer, kind, wasVisible }
  const observed = new Map();

  // Per-kind state: kind -> { present, lastMissingAt, lastNotifiedLabel, lastNotifiedAt }
  const kindState = new Map();

  // --- Debug helpers ----------------------------------------------------
  const DBG = (...args) => console.log("[CGPT Notifier]", ...args);
  const DBG_ERR = (...args) => console.warn("[CGPT Notifier:warn]", ...args);

  function getKindState(kind) {
    let s = kindState.get(kind);
    if (!s) {
      s = {
        present: 0,
        lastMissingAt: 0,
        lastNotifiedLabel: null,
        lastNotifiedAt: 0,
      };
      kindState.set(kind, s);
    }
    return s;
  }

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

  function isElementVisible(el) {
    if (!(el instanceof Element)) return false;
    const rect = el.getBoundingClientRect?.();
    const style = window.getComputedStyle?.(el);
    if (!rect || !style) return true; // best effort
    if (style.display === "none" || style.visibility === "hidden") return false;
    return rect.width > 0 && rect.height > 0;
  }

  // --- Title encoding helpers (UTF-8 safe base64) -----------------------
  function b64utf8(str) {
    // encodeURIComponent to UTF-8 bytes, then pack to a Latin1 string for btoa
    return btoa(
      encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) =>
        String.fromCharCode(parseInt(p1, 16))
      )
    );
  }
  function getWindowTitleB64() {
    try {
      const base = document.title || location.href || "";
      const b64 = b64utf8(base);
      DBG("Encoded window title:", { base, b64 });
      return b64;
    } catch (e) {
      DBG_ERR("Title base64 encode failed:", e);
      return "";
    }
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
    const bodyLabel = (label && String(label).trim()) || "Composer button changed";
    const title = `ChatGPT::${getWindowTitleB64()}::${bodyLabel}`;
    const ok = await ensureNotifPermission();
    if (ok) {
      try {
        // Per request: empty body, all info in title
        new Notification(title, { body: "" });
        DBG("Notification shown with title only:", title);
      } catch (e) {
        DBG_ERR("Notification() failed, logging instead:", e);
        console.log("[ChatGPT Notifier] (title)", title);
      }
    } else {
      DBG("No notification permission. Would have shown title:", title);
    }
  }

  function shouldNotify(kind, label) {
    const state = getKindState(kind);
    const now = Date.now();
    if (label && label !== state.lastNotifiedLabel) return true;
    if (now - state.lastNotifiedAt > RESURGE_MS) return true; // allow repeat
    return false;
  }

  function markNotified(kind, label) {
    const state = getKindState(kind);
    state.lastNotifiedLabel = label;
    state.lastNotifiedAt = Date.now();
  }

  function scheduleNotify(el, label, kind, reason = "mutation") {
    const rec = observed.get(el);
    if (!rec) return;

    if (!shouldNotify(kind, label)) {
      DBG("Deduped notify (reason:", reason + ")", "kind:", kind, "label:", label);
      return;
    }

    markNotified(kind, label);
    clearTimeout(rec.timer);
    rec.timer = setTimeout(() => notifyWithLabel(label), 120);
    DBG("Scheduled notify (reason:", reason + ")", "kind:", kind, "label:", label);
  }

  function maybeInitialNotify(btn, kind, { reappeared } = { reappeared: false }) {
    const label = btn.getAttribute("aria-label") || "";
    if (reappeared) {
      DBG("Initial notify due to reappearance. kind:", kind, "label:", label);
      // bypass dedupe on reappearance but still mark
      markNotified(kind, label);
      const rec = observed.get(btn);
      if (rec) {
        clearTimeout(rec.timer);
        rec.timer = setTimeout(() => notifyWithLabel(label), 60);
      } else {
        notifyWithLabel(label);
      }
      return;
    }
    if (shouldNotify(kind, label)) {
      DBG("Initial notify (label/state change). kind:", kind, "label:", label);
      markNotified(kind, label);
      const rec = observed.get(btn);
      if (rec) {
        clearTimeout(rec.timer);
        rec.timer = setTimeout(() => notifyWithLabel(label), 60);
      } else {
        notifyWithLabel(label);
      }
    } else {
      DBG("Skip initial notify (dedup). kind:", kind, "label:", label);
    }
  }

  function observeButton(btn) {
    if (!btn || observed.has(btn)) return;

    const kind = btnKind(btn);
    const state = getKindState(kind);
    state.present += 1;
    const reappeared = state.present === 1; // transitioned 0 -> 1
    if (reappeared) DBG("Kind reappeared:", kind);

    const rec = { observer: null, io: null, timer: null, kind, wasVisible: null };
    observed.set(btn, rec);

    const currentLabel = btn.getAttribute("aria-label") || "";
    rec.wasVisible = isElementVisible(btn);
    DBG("Observing button:", {
      kind,
      label: currentLabel,
      node: btn,
      visible: rec.wasVisible,
      presentCount: state.present,
    });

    // Observe attribute/child changes on the button
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
      DBG(
        "Mutation detected.",
        "kind:",
        kind,
        "new label:",
        label,
        "mutations:",
        mutations
      );
      scheduleNotify(btn, label, kind, "mutation");
    });

    rec.observer.observe(btn, {
      attributes: true,
      attributeFilter: OBS_ATTRS,
      childList: true,
      subtree: true,
    });

    // Visibility-based trigger (covers cases where node stays but becomes visible again)
    if ("IntersectionObserver" in window) {
      rec.io = new IntersectionObserver(
        (entries) => {
          const e = entries[0];
          if (!e) return;
          const nowVis = e.isIntersecting;
          if (nowVis && !rec.wasVisible) {
            const label = btn.getAttribute("aria-label") || "";
            DBG("Visibility on -> notify. kind:", kind, "label:", label);
            scheduleNotify(btn, label, kind, "visible");
          }
          rec.wasVisible = nowVis;
        },
        { threshold: 0.01 }
      );
      try {
        rec.io.observe(btn);
      } catch (e) {
        DBG_ERR("IntersectionObserver.observe failed:", e);
      }
    } else {
      // Fallback: check visibility opportunistically on rescans
      rec.wasVisible = isElementVisible(btn);
    }

    // Fire an initial notification (handles attach/recreation)
    maybeInitialNotify(btn, kind, { reappeared });
  }

  function cleanupDisconnected() {
    for (const [el, rec] of Array.from(observed.entries())) {
      if (!el.isConnected) {
        const kind = rec.kind;
        try {
          rec.observer && rec.observer.disconnect();
        } catch (e) {
          DBG_ERR("observer.disconnect error:", e);
        }
        try {
          rec.io && rec.io.disconnect();
        } catch (e) {
          DBG_ERR("io.disconnect error:", e);
        }
        clearTimeout(rec.timer);
        observed.delete(el);

        const state = getKindState(kind);
        state.present = Math.max(0, state.present - 1);
        if (state.present === 0) {
          state.lastMissingAt = Date.now();
          DBG("Kind now absent:", kind);
        }
        DBG("Cleaned up disconnected button. kind:", kind, "present:", state.present);
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

    // Fallback visibility edge: if a tracked button is visible again without IO,
    // trigger a notify (rare path — older browsers / IO disabled).
    for (const [el, rec] of observed.entries()) {
      const nowVis = isElementVisible(el);
      if (nowVis && rec.wasVisible === false) {
        const label = el.getAttribute("aria-label") || "";
        DBG("Fallback vis-on -> notify. kind:", rec.kind, "label:", label);
        scheduleNotify(el, label, rec.kind, "visible-fallback");
      }
      rec.wasVisible = nowVis;
    }
  }

  function start() {
    DBG("Content script loaded. Starting observers…");

    // Initial pass
    scanAndAttach("initial");

    // Watch the whole document for dynamic UI changes (button recreate, etc.)
    const docObserver = new MutationObserver((mutationList) => {
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
