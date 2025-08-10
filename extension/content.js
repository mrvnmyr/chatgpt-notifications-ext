(() => {
  "use strict";

  // The exact XPath provided in the prompt:
  const XPATH = "//div[@data-testid='composer-trailing-actions']//button[@id='composer-submit-button' or @data-testid='composer-speech-button']";

  // Track which nodes we’re already observing to avoid duplicates.
  const observedButtons = new WeakSet();

  function xAll(xpath, root = document) {
    const snapshot = document.evaluate(xpath, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    const results = [];
    for (let i = 0; i < snapshot.snapshotLength; i++) {
      results.push(snapshot.snapshotItem(i));
    }
    return results;
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
    if (!label) return;
    const ok = await ensureNotifPermission();
    if (ok) {
      try {
        new Notification("ChatGPT Button Changed", { body: label });
      } catch (e) {
        // Fallback to console if notifications fail.
        console.log("[ChatGPT Button Change Notifier]", label);
      }
    } else {
      // No permission: stay quiet but log to console for debugging.
      console.log("[ChatGPT Button Change Notifier] (no notification permission) aria-label:", label);
    }
  }

  function observeButton(btn) {
    if (!btn || observedButtons.has(btn)) return;
    observedButtons.add(btn);

    let lastLabel = btn.getAttribute("aria-label") || "";

    const mo = new MutationObserver((mutations) => {
      // Consider "changes" to be attribute or subtree changes on the button.
      let relevantChange = false;
      for (const m of mutations) {
        if (m.type === "attributes") {
          // Prioritize aria-label changes, but allow other attribute changes to qualify as "change"
          if (m.attributeName === "aria-label" || m.attributeName === "class" || m.attributeName === "disabled") {
            relevantChange = true;
            break;
          }
        } else if (m.type === "childList" || m.type === "subtree") {
          relevantChange = true;
          break;
        }
      }

      if (!relevantChange) return;

      const currentLabel = btn.getAttribute("aria-label") || "";
      if (currentLabel && currentLabel !== lastLabel) {
        lastLabel = currentLabel;
        notifyWithLabel(currentLabel);
      }
    });

    mo.observe(btn, {
      attributes: true,
      attributeFilter: ["aria-label", "class", "disabled"],
      childList: true,
      subtree: true
    });
  }

  function scanAndAttach() {
    const buttons = xAll(XPATH);
    buttons.forEach(observeButton);
  }

  function start() {
    // Initial scan
    scanAndAttach();

    // Keep scanning as the page dynamically updates
    const domObserver = new MutationObserver(() => {
      scanAndAttach();
    });
    domObserver.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
