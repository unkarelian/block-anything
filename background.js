// Block Anything — background script.
// Owns settings, the classification cache, and all calls to OpenRouter.

const DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";

const DEFAULTS = {
  enabled: true,
  apiKey: "",
  // Jev, or any other model served on OpenRouter's Decisions API.
  decisionsModel: "typesafe/jev-1.14",
  threshold: 0.7,
  pendingMode: "blur", // blur | hide | show
  blockedMode: "hide", // hide | dim
  concurrency: 6,
  rules: [
    { id: "r1", text: "Don't show me videos about politics", sites: "youtube.com", enabled: true }
  ]
};

const CACHE_LIMIT = 5000;

let cache = null; // Map<key, result>
let persistTimer = null;
let lastError = null;
const stats = { requests: 0, cacheHits: 0, blocked: 0, cost: 0 };

// Read fresh every time: content scripts re-fetch settings from their own
// storage.onChanged listener, which can fire before a memo here would be invalidated.
async function getSettings() {
  const { settings } = await browser.storage.local.get("settings");
  return { ...DEFAULTS, ...(settings || {}) };
}

async function getCache() {
  if (!cache) {
    const { cache: stored } = await browser.storage.local.get("cache");
    cache = new Map(stored || []);
  }
  return cache;
}

function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(async () => {
    let entries = [...cache.entries()];
    if (entries.length > CACHE_LIMIT) {
      entries.sort((a, b) => b[1].ts - a[1].ts);
      entries = entries.slice(0, CACHE_LIMIT);
      cache = new Map(entries);
    }
    await browser.storage.local.set({ cache: entries });
  }, 2000);
}

async function sha(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function siteMatches(ruleSites, hostname) {
  const list = (ruleSites || "*").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (list.length === 0 || list.includes("*")) return true;
  return list.some((d) => hostname === d || hostname.endsWith("." + d));
}

function applicableRules(settings, hostname) {
  return settings.rules.filter((r) => r.enabled && r.text.trim() && siteMatches(r.sites, hostname));
}

// Run async tasks with at most `limit` in flight.
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function apiError(res) {
  let msg = `HTTP ${res.status}`;
  try {
    const body = await res.json();
    if (body?.error?.message) msg += `: ${body.error.message}`;
  } catch {}
  return new Error(msg);
}

function headers(settings) {
  return {
    Authorization: `Bearer ${settings.apiKey}`,
    "Content-Type": "application/json",
    "X-Title": "Block Anything"
  };
}

// Decisions API (Jev): one request per item, one yes/no question per rule.
async function classifyDecisions(settings, rules, site, text) {
  const questions = {};
  rules.forEach((r, i) => {
    questions["r" + i] = {
      type: "noul",
      instructions:
        `The user set this content filter for their feed: "${r.text}". ` +
        `Should this item be hidden under that filter?`,
      criteria: {
        true: "The item clearly falls under what the filter asks to hide.",
        false: "The item does not fall under the filter, or there is not enough information to tell."
      }
    };
  });

  const res = await fetch(DECISIONS_URL, {
    method: "POST",
    headers: headers(settings),
    body: JSON.stringify({
      model: settings.decisionsModel,
      state: { site, item: text },
      questions
    })
  });
  stats.requests++;
  if (!res.ok) throw await apiError(res);
  const data = await res.json();
  if (typeof data.usage?.cost === "number") stats.cost += data.usage.cost;

  const scores = rules.map((r, i) => {
    const a = data.answers?.["r" + i];
    return { rule: r.text, p: a && typeof a.noul === "number" ? a.noul : 0, refused: a?.type === "refus" };
  });
  return toResult(settings, scores);
}

function toResult(settings, scores) {
  let best = { rule: null, p: 0 };
  for (const s of scores) if (s.p > best.p) best = s;
  return {
    block: best.p >= settings.threshold,
    score: best.p,
    rule: best.rule,
    scores,
    ts: Date.now()
  };
}

async function classify(texts, hostname) {
  const settings = await getSettings();
  if (!settings.enabled) return texts.map(() => ({ block: false, skipped: "disabled" }));
  if (!settings.apiKey) return texts.map(() => ({ block: false, skipped: "no API key" }));
  const rules = applicableRules(settings, hostname);
  if (rules.length === 0) return texts.map(() => ({ block: false, skipped: "no rules for site" }));

  const c = await getCache();
  const sig = JSON.stringify([settings.decisionsModel, rules.map((r) => r.text)]);

  const results = new Array(texts.length);
  const todo = [];
  for (let i = 0; i < texts.length; i++) {
    const key = await sha(sig + "\n" + texts[i]);
    const hit = c.get(key);
    if (hit) {
      stats.cacheHits++;
      // Re-apply the current threshold so threshold changes don't need a cache flush.
      results[i] = { ...hit, block: hit.score >= settings.threshold, cached: true };
    } else {
      todo.push({ i, key, text: texts[i] });
    }
  }

  try {
    await pool(todo, settings.concurrency, async (t) => {
      try {
        results[t.i] = await classifyDecisions(settings, rules, hostname, t.text);
        c.set(t.key, results[t.i]);
      } catch (e) {
        lastError = String(e.message || e);
        results[t.i] = { block: false, error: lastError };
      }
    });
  } finally {
    if (todo.length) schedulePersist();
  }

  stats.blocked += results.filter((r) => r.block).length;
  return results;
}

browser.runtime.onMessage.addListener((msg) => {
  switch (msg?.type) {
    case "classify":
      return classify(msg.items, msg.hostname);
    case "getSettings":
      return getSettings();
    case "getDefaults":
      return Promise.resolve(DEFAULTS);
    case "getStatus":
      return getCache().then((c) => ({ stats, lastError, cacheSize: c.size }));
    case "clearCache":
      cache = new Map();
      return browser.storage.local.set({ cache: [] }).then(() => true);
  }
});
