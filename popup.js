const $ = (id) => document.getElementById(id);

(async () => {
  const settings = await browser.runtime.sendMessage({ type: "getSettings" });
  $("enabled").checked = settings.enabled;
  $("enabled").onchange = async () => {
    const s = await browser.runtime.sendMessage({ type: "getSettings" });
    await browser.storage.local.set({ settings: { ...s, enabled: $("enabled").checked } });
  };
  $("options").onclick = () => browser.runtime.openOptionsPage().then(() => window.close());

  if (!settings.apiKey) $("err").textContent = "Add your OpenRouter API key in settings.";

  const status = await browser.runtime.sendMessage({ type: "getStatus" });
  $("requests").textContent = status.stats.requests;
  $("hits").textContent = status.stats.cacheHits;
  $("cost").textContent = "$" + status.stats.cost.toFixed(4);
  $("cache").textContent = status.cacheSize;
  if (status.lastError) $("err").textContent = "Last error: " + status.lastError;

  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const t = await browser.tabs.sendMessage(tab.id, { type: "tabStats" });
    $("tab").textContent =
      `${t.site}: ${t.blocked} blocked of ${t.checked} checked` +
      (t.pending ? `, ${t.pending} pending` : "") +
      (t.errors ? `, ${t.errors} errors` : "");
  } catch {
    // No content script on this tab, so the site isn't supported.
  }
})();
