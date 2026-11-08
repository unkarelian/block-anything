const $ = (id) => document.getElementById(id);
const FIELDS = ["apiKey", "decisionsModel", "threshold", "concurrency", "pendingMode", "blockedMode"];
let rules = [];

function renderRules() {
  const box = $("rules");
  box.textContent = "";
  rules.forEach((r, i) => {
    const row = document.createElement("div");
    row.className = "rule";

    const on = document.createElement("input");
    on.type = "checkbox";
    on.checked = r.enabled;
    on.title = "Enabled";
    on.onchange = () => (r.enabled = on.checked);

    const text = document.createElement("input");
    text.type = "text";
    text.value = r.text;
    text.placeholder = "e.g. Hide anything about celebrity gossip";
    text.oninput = () => (r.text = text.value);

    const sites = document.createElement("input");
    sites.type = "text";
    sites.className = "sites";
    sites.value = r.sites;
    sites.placeholder = "youtube.com or *";
    sites.oninput = () => (r.sites = sites.value);

    const del = document.createElement("button");
    del.textContent = "✕";
    del.title = "Delete rule";
    del.onclick = () => {
      rules.splice(i, 1);
      renderRules();
    };

    row.append(on, text, sites, del);
    box.append(row);
  });
}

async function load() {
  const s = await browser.runtime.sendMessage({ type: "getSettings" });
  for (const f of FIELDS) $(f).value = s[f];
  $("thresholdVal").textContent = Number(s.threshold).toFixed(2);
  rules = structuredClone(s.rules);
  renderRules();
}

async function save() {
  const current = await browser.runtime.sendMessage({ type: "getSettings" });
  const next = { ...current, rules: rules.filter((r) => r.text.trim()) };
  for (const f of FIELDS) next[f] = $(f).value;
  next.apiKey = next.apiKey.trim();
  next.threshold = Number(next.threshold);
  next.concurrency = Math.max(1, Math.min(20, Number(next.concurrency) || 6));
  await browser.storage.local.set({ settings: next });
  $("saved").textContent = "Saved.";
  setTimeout(() => ($("saved").textContent = ""), 2000);
}

$("threshold").oninput = () => ($("thresholdVal").textContent = Number($("threshold").value).toFixed(2));
$("addRule").onclick = () => {
  rules.push({ id: "r" + Date.now(), text: "", sites: "*", enabled: true });
  renderRules();
};
$("save").onclick = save;
$("clearCache").onclick = async () => {
  await browser.runtime.sendMessage({ type: "clearCache" });
  $("saved").textContent = "Cache cleared.";
};
$("runTest").onclick = async () => {
  const items = $("testItems").value.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!items.length) return;
  $("testOut").textContent = "Checking…";
  const t0 = performance.now();
  const results = await browser.runtime.sendMessage({
    type: "classify",
    hostname: $("testSite").value.trim(),
    items
  });
  const ms = Math.round(performance.now() - t0);
  const out = $("testOut");
  out.textContent = `${items.length} item(s) in ${ms} ms\n\n`;
  results.forEach((r, i) => {
    const line = document.createElement("div");
    if (r.skipped) {
      line.textContent = `– skipped (${r.skipped}): ${items[i]}`;
    } else if (r.error) {
      line.className = "bad";
      line.textContent = `! error: ${r.error}`;
    } else {
      line.className = r.block ? "bad" : "good";
      const detail = r.scores.map((s) => `${s.p.toFixed(2)} "${s.rule}"`).join(", ");
      line.textContent = `${r.block ? "BLOCK" : "allow"}  ${items[i]}\n       ${detail}${r.cached ? "  (cached)" : ""}`;
    }
    out.append(line);
  });
};

load();
