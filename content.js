/* global BA_ADAPTERS */
// Block Anything — content script. Finds feed items, asks the background script
// to classify them, and hides the ones that match a rule.

(() => {
  const host = location.hostname.replace(/^www\./, "");
  const adapter = BA_ADAPTERS.find((a) => a.hosts.some((h) => host === h || host.endsWith("." + h)));
  if (!adapter) return;

  const BATCH = 10;
  const STATE = "baState"; // pending | ok | blocked | error
  const TEXT = "baText";
  let settings = null;
  let queue = []; // { el, text }
  let inFlight = 0;
  let scanTimer = null;
  let blockedCount = 0;

  const targets = (el) => [el, ...(adapter.companions ? adapter.companions(el) : [])];

  function clearClasses(el) {
    for (const t of targets(el)) t.classList.remove("ba-pending-blur", "ba-pending-hide", "ba-hidden", "ba-dim");
  }

  function applyState(el, state, result) {
    clearClasses(el);
    el.dataset[STATE] = state;
    if (state === "pending" && settings.pendingMode !== "show") {
      targets(el).forEach((t) => t.classList.add(settings.pendingMode === "hide" ? "ba-pending-hide" : "ba-pending-blur"));
    } else if (state === "blocked") {
      targets(el).forEach((t) => t.classList.add(settings.blockedMode === "dim" ? "ba-dim" : "ba-hidden"));
      el.title = `Blocked by Block Anything (${Math.round(result.score * 100)}%): ${result.rule}`;
    }
  }

  function scan() {
    if (!settings?.enabled) return;
    for (const el of document.querySelectorAll(adapter.selector)) {
      // Skip items nested inside another matched item (e.g. lockup inside rich-item).
      if (el.parentElement?.closest(adapter.selector)) continue;
      const text = adapter.extract(el);
      if (!text) continue;
      // Sites recycle elements for new content, so re-check whenever the text changes.
      if (el.dataset[TEXT] === text) continue;
      el.dataset[TEXT] = text;
      applyState(el, "pending");
      queue.push({ el, text });
    }
    pump();
  }

  async function pump() {
    while (queue.length && inFlight < 3) {
      const batch = queue.splice(0, BATCH);
      inFlight++;
      try {
        const results = await browser.runtime.sendMessage({
          type: "classify",
          hostname: host,
          items: batch.map((b) => b.text)
        });
        batch.forEach(({ el, text }, i) => {
          if (el.dataset[TEXT] !== text) return; // element was reused meanwhile
          const r = results[i] || {};
          if (r.block) blockedCount++;
          applyState(el, r.error ? "error" : r.block ? "blocked" : "ok", r);
        });
      } catch (e) {
        // Fail open: never leave content hidden because the filter broke.
        batch.forEach(({ el }) => applyState(el, "error"));
        console.warn("[Block Anything]", e);
      } finally {
        inFlight--;
      }
    }
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 250);
  }

  function resetAll() {
    queue = [];
    blockedCount = 0;
    for (const el of document.querySelectorAll(`[data-ba-text]`)) {
      clearClasses(el);
      delete el.dataset[TEXT];
      delete el.dataset[STATE];
      el.removeAttribute("title");
    }
  }

  browser.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local" || !changes.settings) return;
    settings = await browser.runtime.sendMessage({ type: "getSettings" });
    resetAll();
    scan();
  });

  browser.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "tabStats") {
      return Promise.resolve({
        site: adapter.name,
        blocked: blockedCount,
        checked: document.querySelectorAll('[data-ba-state="ok"],[data-ba-state="blocked"]').length,
        pending: document.querySelectorAll('[data-ba-state="pending"]').length,
        errors: document.querySelectorAll('[data-ba-state="error"]').length
      });
    }
  });

  (async () => {
    settings = await browser.runtime.sendMessage({ type: "getSettings" });
    new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    scan();
  })();
})();
