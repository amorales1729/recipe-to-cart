// Toolbar button. On a recipe page: save the recipe and open the cart review for it.
// Anywhere else: open your saved recipes.
import { fromPage, readRecipePage } from "./lib/recipe.js";
import { saveRecipe } from "./lib/storage.js";
import { POLL_MINUTES, poll, updateBadge } from "./inbox.js";
import { listen } from "./push.js";

async function openPage(path) {
  // Reuse an open Recipe to Cart tab instead of piling up new ones.
  const ours = chrome.runtime.getURL("");
  const existing = (await chrome.tabs.query({})).find((t) => (t.url || "").startsWith(ours));
  const url = chrome.runtime.getURL(path);
  if (existing) {
    await chrome.tabs.update(existing.id, { url, active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

async function shopForTab(tab) {
  const url = tab.url || "";
  if (!/^https?:/.test(url) || /^https:\/\/([a-z0-9-]+\.)*walmart\.com\//.test(url)) {
    return openPage("app.html");
  }
  let page;
  try {
    // The click lets the extension read this one tab (activeTab); no access to other sites.
    [{ result: page }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readRecipePage });
  } catch {
    return openPage(`app.html?error=${encodeURIComponent("Chrome didn't let the extension read that page.")}`);
  }
  try {
    const recipe = await saveRecipe(fromPage(page));
    await openPage(`cart.html?recipes=${recipe.id}`);
  } catch (e) {
    await openPage(`app.html?error=${encodeURIComponent(e.message)}`);
  }
}

// Recipes from your phone show up on the Recipes page, which the button opens off a recipe page.
chrome.action.onClicked.addListener(shopForTab);

// Recipes from your phone: check when Chrome starts, then every few minutes while it's open.
// With instant pickup on, a ping from the inbox (push.js) checks right away; the timer is the backup.
chrome.alarms.get("phone-inbox").then((alarm) => {
  if (!alarm) chrome.alarms.create("phone-inbox", { periodInMinutes: POLL_MINUTES, delayInMinutes: 0.1 });
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "phone-inbox") return;
  listen().catch(() => {}); // reopens the listener if Chrome closed it
  poll();
});
chrome.runtime.onStartup.addListener(() => { updateBadge(); poll(); });
chrome.runtime.onMessage.addListener((msg) => { if (msg?.type === "phone-ping") poll(); });
chrome.storage.onChanged.addListener((changes) => { if (changes.phoneSettings) listen().catch(() => {}); });
listen().catch(() => {});
globalThis.shopForTab = shopForTab; // lets the browser test press the button
globalThis.pollPhoneInbox = poll;
