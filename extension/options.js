(function () {
  "use strict";
  const el = document.getElementById("debug");

  function load() {
    try {
      const sync = chrome?.storage?.sync;
      if (!sync) return;
      sync.get({ cgpt_debug: false }, (res) => {
        el.checked = !!res.cgpt_debug;
      });
    } catch {}
  }

  function save() {
    try {
      const sync = chrome?.storage?.sync;
      if (!sync) return;
      sync.set({ cgpt_debug: !!el.checked });
    } catch {}
  }

  document.addEventListener("DOMContentLoaded", () => {
    load();
    el.addEventListener("change", save);
  });
})();
