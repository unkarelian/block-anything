// Site adapters: how to find feed items on a page and turn each into text for the model.
// To support a new site, add an entry here and its URL to manifest.json.
//   selector: CSS selector for one feed item (nested matches are de-duplicated)
//   extract(el): text describing the item, or null if it hasn't rendered yet
//   companions(el): optional extra elements to hide along with the item

const txt = (el, sel) => (el.querySelector(sel)?.textContent || "").replace(/\s+/g, " ").trim();
const lines = (pairs) =>
  pairs.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n") || null;

// eslint-disable-next-line no-unused-vars
const BA_ADAPTERS = [
  {
    name: "youtube",
    hosts: ["youtube.com"],
    selector: [
      "ytd-rich-item-renderer",
      "ytd-video-renderer",
      "ytd-compact-video-renderer",
      "ytd-grid-video-renderer",
      "ytd-reel-item-renderer",
      "ytd-playlist-renderer",
      "yt-lockup-view-model",
      "ytm-shorts-lockup-view-model"
    ].join(","),
    extract(el) {
      const title =
        txt(el, "#video-title") ||
        txt(el, ".yt-lockup-metadata-view-model__title") ||
        txt(el, ".shortsLockupViewModelHostMetadataTitle") ||
        txt(el, "h3");
      if (!title) return null;
      const channel =
        txt(el, "ytd-channel-name #text") ||
        txt(el, ".yt-content-metadata-view-model__metadata-text") ||
        txt(el, "#channel-name");
      const desc = txt(el, "#description-text, .metadata-snippet-text").slice(0, 200);
      return lines([["Title", title], ["Channel", channel], ["Description", desc]]);
    }
  },
  {
    name: "reddit",
    hosts: ["reddit.com"],
    selector: "shreddit-post, div.thing.link",
    extract(el) {
      if (el.tagName === "SHREDDIT-POST") {
        return lines([
          ["Title", el.getAttribute("post-title")],
          ["Subreddit", el.getAttribute("subreddit-prefixed-name")],
          ["Text", txt(el, '[slot="text-body"]').slice(0, 300)]
        ]);
      }
      // old.reddit.com
      return lines([
        ["Title", txt(el, "a.title")],
        ["Subreddit", el.dataset.subreddit && "r/" + el.dataset.subreddit],
        ["Domain", el.dataset.domain]
      ]);
    }
  },
  {
    name: "x",
    hosts: ["x.com", "twitter.com"],
    selector: 'article[data-testid="tweet"]',
    extract(el) {
      const body = txt(el, '[data-testid="tweetText"]');
      const author = txt(el, '[data-testid="User-Name"]');
      if (!body && !author) return null;
      return lines([["Author", author], ["Post", body.slice(0, 500)]]);
    }
  },
  {
    name: "hackernews",
    hosts: ["news.ycombinator.com"],
    selector: "tr.athing",
    extract(el) {
      return lines([["Title", txt(el, ".titleline > a")], ["Site", txt(el, ".sitestr")]]);
    },
    companions(el) {
      const sub = el.nextElementSibling;
      const spacer = sub?.nextElementSibling;
      return [sub, spacer?.classList.contains("spacer") ? spacer : null].filter(Boolean);
    }
  }
];
