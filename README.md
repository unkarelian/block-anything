# Block Anything

A Firefox extension that hides feed items matching plain-English rules, such as "don't show me videos about politics". It works on YouTube, Reddit, X and Hacker News.

## Try it

1. Open `about:debugging#/runtime/this-firefox` and click **Load Temporary Add-on…**, then pick `manifest.json`.
2. Open the extension's settings, paste an OpenRouter API key, and edit the rules.
3. Use **Try a rule** on the settings page to check scores before browsing.

## How it works

- `adapters.js` finds feed items on each site and turns them into short text (title, channel, subreddit and so on).
- `content.js` blurs new items, sends them in batches to the background script, then hides or reveals them. If anything fails, it shows the content rather than hiding it.
- `background.js` checks a SHA-256-keyed cache, then calls OpenRouter's **Decisions API** (`POST https://openrouter.ai/api/alpha/decisions`, default `typesafe/jev-1.14`). It sends one request per item, with one `noul` yes/no question per rule. The answer is P(yes), and an item is blocked when any rule's probability reaches the threshold. Output tokens are free, so cost is roughly input tokens only.
- The cache stores probabilities, not verdicts, so changing the threshold doesn't need fresh API calls. Changing rules or the model does.

## Adding a site

Add an entry to `BA_ADAPTERS` in `adapters.js` with a `selector` and an `extract(el)`, then add the domain to `host_permissions` and `content_scripts.matches` in `manifest.json`.

## Notes

- The API key lives in `browser.storage.local`. That's fine for a personal, bring-your-own-key extension. A published version that bills to your own key would need a small backend proxy.
- Site selectors break when sites change their markup. YouTube is the most likely to drift.
