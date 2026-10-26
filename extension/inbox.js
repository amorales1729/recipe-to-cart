// Recipes sent from your iPhone wait in your Google inbox (apps-script/Code.gs) until Chrome
// is open. This file picks them up, saves each one as a recipe, and shows a badge on the
// toolbar button. Used by background.js (polling every few minutes) and phone.html.
import { fromHtml, fromPage, readRecipePage } from "./lib/recipe.js";
import { askedWords, suggestedWords, markAsked, saveSuggestedWords, saveRecipe } from "./lib/storage.js";

export const POLL_MINUTES = 5;
export const ALL_SITES = { origins: ["<all_urls>"] };
const DEFAULTS = { inboxUrl: "", token: "", mode: "review" }; // mode: "review" | "auto"

export async function getSettings() {
  const { phoneSettings } = await chrome.storage.local.get("phoneSettings");
  return { ...DEFAULTS, ...(phoneSettings || {}) };
}

export async function saveSettings(changes) {
  await chrome.storage.local.set({ phoneSettings: { ...(await getSettings()), ...changes } });
}

/** Recipes picked up from the phone that you haven't shopped for yet. */
export async function getWaiting() {
  const { phoneInbox } = await chrome.storage.local.get("phoneInbox");
  return phoneInbox || [];
}

async function setWaiting(list) {
  await chrome.storage.local.set({ phoneInbox: list });
  await updateBadge(list);
}

async function updateWaiting(id, changes) {
  await setWaiting((await getWaiting()).map((r) => (r.id === id ? { ...r, ...changes } : r)));
}

export async function removeWaiting(ids) {
  const drop = new Set(ids);
  await setWaiting((await getWaiting()).filter((r) => !drop.has(r.id)));
}

export async function updateBadge(list) {
  list = list || (await getWaiting());
  const n = list.length;
  await chrome.action.setBadgeBackgroundColor({ color: "#0071dc" });
  await chrome.action.setBadgeText({ text: n ? String(n) : "" });
  await chrome.action.setTitle({
    title: n ? `Recipe to Cart: ${n} recipe${n > 1 ? "s" : ""} from your phone` : "Recipe to Cart: shop for this recipe",
  });
}

// ---- talking to the Google inbox ----

async function call(settings, params) {
  const url = new URL(settings.inboxUrl);
  url.searchParams.set("token", settings.token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { redirect: "follow", credentials: "omit" });
  if (!res.ok) throw new Error(`The inbox answered ${res.status}. Check the web app URL.`);
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error("The inbox didn't answer with data. Check the web app URL, and that \"Who has access\" is Anyone.");
  }
  if (!data.ok) throw new Error(data.error === "bad token" ? "The inbox token doesn't match." : `Inbox error: ${data.error}`);
  return data;
}

async function post(settings, body) {
  // text/plain keeps it a simple request; Apps Script reads the JSON body either way.
  const res = await fetch(settings.inboxUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ ...body, token: settings.token }),
    redirect: "follow",
    credentials: "omit",
  });
  if (!res.ok) throw new Error(`The inbox answered ${res.status}.`);
  const data = await res.json();
  if (!data.ok) throw new Error(`Inbox error: ${data.error}`);
  return data;
}

/** Used by the settings "Test" button. Returns how many recipes are waiting in the inbox. */
export async function testConnection(settings) {
  return ((await call(settings, { action: "list" })).recipes || []).length;
}

// ---- Suggested Walmart searches (the "Search words" tab in the Sheet) ----

/** Send ingredients the rules searched for, so the scheduled task can suggest a better search. Quietly does nothing without an inbox. */
export async function askForWords(items) {
  const settings = await getSettings();
  if (!settings.inboxUrl || !settings.token) return 0;
  const asked = await askedWords();
  const words = items
    .filter((i) => i.querySource === "rules" && !asked.has(i.key))
    .map((i) => ({ key: i.key, name: i.name, guess: i.query }));
  if (!words.length) return 0;
  await post(settings, { action: "ask", words });
  await markAsked(words.map((w) => w.key));
  return words.length;
}

/** Fetch the suggested searches. Returns the stored ones if there's no inbox or it can't be reached. */
export async function pullWords() {
  const settings = await getSettings();
  if (settings.inboxUrl && settings.token) {
    try {
      await saveSuggestedWords((await call(settings, { action: "words" })).words || {});
    } catch { /* keep what we have */ }
  }
  return suggestedWords();
}

// ---- turning a link into a saved recipe ----

async function readInBackgroundTab(url) {
  // For sites that build the recipe with JavaScript: load it in a hidden tab and read it there.
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(done); reject(new Error("The page took too long to load.")); }, 45000);
      function done(id, info) {
        if (id === tab.id && info.status === "complete") {
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(done);
          resolve();
        }
      }
      chrome.tabs.onUpdated.addListener(done);
    });
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readRecipePage });
    return fromPage(result);
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

/** Read and save the recipe behind a link. Throws with a message you can show. */
export async function importLink(url) {
  if (!(await chrome.permissions.contains(ALL_SITES))) {
    throw new Error("Allow the extension to read recipe sites (in the settings below), or open the link and click the toolbar button.");
  }
  let recipe;
  try {
    const res = await fetch(url, { credentials: "omit" });
    recipe = fromHtml(await res.text(), url);
  } catch {
    recipe = await readInBackgroundTab(url);
  }
  return saveRecipe({ ...recipe, fromPhone: true });
}

async function importWaiting(item) {
  try {
    const recipe = await importLink(item.url);
    await updateWaiting(item.id, { recipeId: recipe.id, title: recipe.title, error: null });
    return recipe.id;
  } catch (e) {
    await updateWaiting(item.id, { error: e.message });
    return null;
  }
}

// ---- shopping ----

export function cartPageUrl(recipeIds, auto = false) {
  return chrome.runtime.getURL(`cart.html?recipes=${recipeIds.join(",")}${auto ? "&auto=1" : ""}`);
}

/** Open the cart page for these waiting recipes and clear them from the inbox list. */
export async function shop(items, { auto = false } = {}) {
  const ids = items.map((r) => r.recipeId).filter(Boolean);
  if (!ids.length) return null;
  await removeWaiting(items.filter((r) => r.recipeId).map((r) => r.id));
  return chrome.tabs.create({ url: cartPageUrl(ids, auto), active: !auto });
}

/** Retry links that couldn't be read before (for example after you allowed site access). */
export async function retryFailed() {
  for (const item of await getWaiting()) if (!item.recipeId) await importWaiting(item);
}

// ---- polling ----

let polling = null;

/** Pick up new recipes from the inbox. Returns { added, error }. */
export function poll() {
  polling = polling || pollOnce().finally(() => { polling = null; });
  return polling;
}

async function pollOnce() {
  const settings = await getSettings();
  if (!settings.inboxUrl || !settings.token) return { added: [], error: null };
  let fresh;
  try {
    fresh = (await call(settings, { action: "list" })).recipes || [];
  } catch (e) {
    await chrome.storage.local.set({ phoneLastCheck: { at: Date.now(), error: e.message } });
    return { added: [], error: e.message };
  }
  const waiting = await getWaiting();
  const known = new Set(waiting.map((r) => r.id));
  const added = fresh
    .filter((r) => r.id && r.url && !known.has(r.id))
    .map((r) => ({ id: r.id, url: r.url, title: r.title || "", added: r.added || new Date().toISOString() }));
  // Keep them here before telling the inbox they're picked up, so nothing is lost if Chrome closes.
  if (added.length) await setWaiting([...waiting, ...added]);
  if (fresh.length) {
    // If this fails they're listed again next time, and the ids keep them from doubling up.
    try { await call(settings, { action: "ack", ids: fresh.map((r) => r.id).join(",") }); } catch { /* retried next poll */ }
  }
  await chrome.storage.local.set({ phoneLastCheck: { at: Date.now(), error: null } });
  await pullWords();
  for (const item of added) await importWaiting(item);
  if (added.length && settings.mode === "auto") {
    const ready = (await getWaiting()).filter((r) => added.some((a) => a.id === r.id) && r.recipeId);
    await shop(ready, { auto: true });
  }
  await updateBadge();
  return { added, error: null };
}
