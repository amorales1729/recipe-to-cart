import { AISLES } from "./lib/aisles.js";
import { DEFAULT_PANTRY } from "./lib/grocery.js";
import { buildPlan, productOptions } from "./lib/plan.js";
import * as storage from "./lib/storage.js";
import { parseSearchPage, searchUrl } from "./lib/walmart.js";
import { askForWords, pullWords } from "./inbox.js";
import { addToCartInPage, isBlockedUrl, readPageHtml } from "./walmart_page.js";

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const money = (n) => (typeof n === "number" ? `$${n.toFixed(2)}` : "");

// The list is saved as you go, so leaving the page and coming back picks up where it was.
// shoppingList: {recipeIds, plan, rows: {key: {options, pick, qty, include, result}}, extras,
//   task: null|"finding"|"adding", stopped, done, workerTabId}
const KEY = "shoppingList";

let session = null;
let plan = null;
let usual = {}; // last time's product per ingredient
let workerTabId = null;
const rows = new Map(); // key -> { item, options (null until searched), result, el }
let extras = []; // left-off items added from the kitchen section: {key, price}

let running = null; // "finding" | "adding" while a run is going on this page
let stopRequested = false;
let onStop = null;
class Stopped extends Error {}

// The bar at the top: what's happening, with Stop, Pick up and Start over beside it.
function setStatus(html, cls = "") {
  $("status").innerHTML = html;
  $("status-bar").className = `card status-bar ${cls}`;
  updateBar();
}

function updateBar() {
  const idle = session && !running && !session.task && session.checkedAt;
  const when = idle && new Date(session.checkedAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
  $("status-note").textContent = idle && !$("status").innerHTML ? `Prices checked ${when}.` : "";
  $("status-bar").hidden = !$("status").innerHTML && !$("status-note").textContent && !$("progress").innerHTML;
}

async function save() {
  if (!session) return;
  const saved = {};
  for (const row of rows.values()) {
    saved[row.item.key] = {
      options: row.options,
      pick: Number(row.el.querySelector("select")?.value ?? 0),
      qty: Number(row.el.querySelector("input[type=number]").value || 1),
      include: row.el.querySelector(".include").checked,
      result: row.result,
    };
  }
  session = { ...session, plan, rows: saved, extras, workerTabId };
  await chrome.storage.local.set({ [KEY]: session });
}

// ---- the background Walmart tab the extension works in ----

async function workerTab() {
  if (workerTabId !== null) {
    try { await chrome.tabs.get(workerTabId); return workerTabId; } catch { workerTabId = null; }
  }
  const tab = await chrome.tabs.create({ url: "about:blank", active: false });
  workerTabId = tab.id;
  return workerTabId;
}

async function openInWorker(url) {
  if (isBlockedUrl(url)) throw new Error("Refused to open a checkout or payment page.");
  const tabId = await workerTab();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); reject(new Error("Walmart took too long to load.")); }, 45000);
    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.update(tabId, { url });
  });
  return tabId;
}

async function runInWorker(func, args = []) {
  const [result] = await chrome.scripting.executeScript({ target: { tabId: workerTabId }, func, args });
  return result.result;
}

async function waitForHuman() {
  await chrome.tabs.update(workerTabId, { active: true });
  setStatus(
    `<strong>Walmart wants to check you're human.</strong> Finish the check in the Walmart tab, then come back here.
     <br><button class="primary" id="resume">I'm done, continue</button>`, "bad");
  await new Promise((r) => { onStop = r; $("resume").addEventListener("click", r, { once: true }); });
  onStop = null;
  if (stopRequested) throw new Stopped("Stopped.");
  setStatus("Continuing…");
}

// ---- building the list ----

const icon = (paths, size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const PHOTO = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#a3a79e" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/></svg>`;
const CHEVRON = icon(`<path d="M6 9l6 6 6-6"/>`, 18);
const SEARCH = icon(`<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>`, 14);
const EXTERNAL = icon(`<path d="M14 4h6v6"/><path d="M10 14L20 4"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>`, 14);
const PLUS = icon(`<path d="M12 5v14M5 12h14"/>`, 14);

function render() {
  $("recipes").innerHTML = plan.recipes.map((t) => recipeTag(t, "pill")).join("");
  $("for-line").hidden = false;
  $("empty-list").hidden = true;
  $("list-area").hidden = false;
  rows.clear();
  const container = $("rows");
  container.innerHTML = "";
  for (const [aisle, label] of AISLES) {
    const items = plan.items.filter((i) => i.aisle === aisle);
    if (!items.length) continue;
    const section = document.createElement("section");
    section.className = "aisle";
    section.dataset.aisle = aisle;
    section.innerHTML = `
      <button class="aisle-head" aria-expanded="true">
        <span class="name">${escapeHtml(label)}</span><span class="count"></span><span class="subtotal"></span>${CHEVRON}
      </button>
      <div class="aisle-items"></div>`;
    const head = section.querySelector(".aisle-head");
    head.addEventListener("click", () => {
      const open = head.getAttribute("aria-expanded") !== "true";
      head.setAttribute("aria-expanded", String(open));
      section.querySelector(".aisle-items").hidden = !open;
    });
    for (const item of items) section.querySelector(".aisle-items").appendChild(itemRow(item));
    container.appendChild(section);
  }
  showLeftOff();
}

function showEmpty() {
  session = null;
  $("for-line").hidden = true;
  $("list-area").hidden = true;
  $("empty-list").hidden = false;
  $("progress").innerHTML = "";
  setStatus("");
}

// Each recipe keeps one color, on its pill at the top and on the tag of every item it needs.
function recipeTag(title, cls = "tag") {
  const n = Math.max(0, plan.recipes.indexOf(title)) % 6;
  return `<span class="${cls} recipe-${n}">${escapeHtml(title)}</span>`;
}

function itemRow(item) {
  const el = document.createElement("div");
  el.className = "item";
  el.dataset.key = item.key;
  el.innerHTML = `
    <input type="checkbox" class="include" checked aria-label="Include ${escapeHtml(item.name)}">
    <div class="thumb">${PHOTO}</div>
    <div class="info">
      <div><span class="ing query">${escapeHtml(item.query)}</span><span class="need">${item.amount === "as needed" ? "As needed" : `Need ${escapeHtml(item.amount)}`}</span></div>
      <div class="from">(${escapeHtml(item.name)})</div>
      <div class="product"><span class="muted small">Not searched yet</span></div>
      <div class="meta">
        <span class="tags">${item.sources.map((t) => recipeTag(t)).join("")}</span>
        <button class="chip-btn change">${SEARCH}Change search</button>
      </div>
    </div>
    <div class="qty">
      <button class="dec" aria-label="One less ${escapeHtml(item.name)}">−</button>
      <input type="number" min="1" value="1" aria-label="How many ${escapeHtml(item.name)}">
      <button class="inc" aria-label="One more ${escapeHtml(item.name)}">+</button>
    </div>
    <div class="price"><div class="line-total"></div><div class="each"></div></div>
    <div class="state"></div>`;
  const row = { item, options: null, result: null, el };
  rows.set(item.key, row);
  const qty = el.querySelector("input[type=number]");
  const step = (d) => { qty.value = Math.max(1, Number(qty.value || 1) + d); changed(); };
  el.querySelector(".dec").addEventListener("click", () => step(-1));
  el.querySelector(".inc").addEventListener("click", () => step(1));
  qty.addEventListener("input", changed);
  el.querySelector(".change").addEventListener("click", () => changeSearch(row));
  el.querySelector(".include").addEventListener("change", (e) => {
    el.classList.toggle("skipped", !e.target.checked);
    changed();
  });
  return el;
}

function changed() {
  updateTotal();
  save();
}

// Show the products found for a row. `saved` restores your pick, amount and tick from last time.
function showOptions(row, saved = null) {
  const cell = row.el.querySelector(".product");
  const qty = row.el.querySelector("input[type=number]");
  const include = row.el.querySelector(".include");
  if (row.options === null) {
    cell.innerHTML = `<span class="muted small">Not searched yet</span>`;
    return;
  }
  if (!row.options.length) {
    cell.innerHTML = `<span class="bad small">Nothing found.</span> <a class="chip-btn" href="${row.item.searchUrl}" target="_blank">${EXTERNAL}Search Walmart</a>`;
    include.checked = false;
    row.el.classList.add("skipped");
    updateTotal();
    return;
  }
  const select = document.createElement("select");
  select.setAttribute("aria-label", `Product for ${row.item.name}`);
  row.options.forEach((o, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    const notes = [money(o.price), o.cheapest && "cheapest", o.usual && "your usual", o.available === false && "out of stock"];
    opt.textContent = [o.name, ...notes.filter(Boolean)].join(" · ");
    select.appendChild(opt);
  });
  const apply = () => {
    const o = row.options[select.value];
    qty.value = o.qty;
    const thumb = row.el.querySelector(".thumb");
    thumb.innerHTML = o.image ? `<img src="${escapeHtml(o.image)}" alt="" style="width: 100%; height: 100%; object-fit: contain">` : PHOTO;
  };
  select.addEventListener("change", () => { apply(); changed(); });
  cell.innerHTML = "";
  cell.appendChild(select);
  if (saved && saved.pick < row.options.length) select.value = saved.pick;
  apply();
  if (saved) {
    qty.value = saved.qty;
    include.checked = saved.include;
    row.el.classList.toggle("skipped", !saved.include);
  }
  updateTotal();
}

// What happened when the row was added to the cart. An added row is locked so it isn't added twice.
function showResult(row) {
  const r = row.result;
  const state = row.el.querySelector(".state");
  const open = r && r.url ? ` <a class="chip-btn" href="${escapeHtml(r.url)}" target="_blank">${EXTERNAL}Open</a>` : "";
  if (!r) state.innerHTML = "";
  else if (r.pending) state.textContent = "Adding…";
  else if (r.ok) state.innerHTML = `<span class="ok">✓ ${escapeHtml(r.message)}</span>`;
  else state.innerHTML = `<span class="bad">${escapeHtml(r.message)}</span>${open}`;
  const locked = Boolean(r && r.ok);
  row.el.classList.toggle("added", locked);
  for (const control of row.el.querySelectorAll("select, .include, .qty button, .qty input, .change")) control.disabled = locked;
}

function selected(row) {
  const select = row.el.querySelector("select");
  return select && row.options ? row.options[select.value] : null;
}

const included = (row) => selected(row) && row.el.querySelector(".include").checked;
const settled = (row) => row.result && (row.result.ok || row.result.unsure);

function updateTotal() {
  let total = 0, count = 0, toAdd = 0;
  const bySection = new Map();
  for (const row of rows.values()) {
    const o = selected(row);
    const n = Number(row.el.querySelector("input[type=number]").value || 0);
    const line = o && o.price > 0 ? o.price * n : null;
    row.el.querySelector(".line-total").textContent = !o ? "" : line === null ? "No price" : money(line);
    row.el.querySelector(".each").textContent = o && n > 1 ? `${money(o.price)} each` : "";
    if (!included(row)) continue;
    count++;
    if (!settled(row)) toAdd++;
    total += line || 0;
    const s = bySection.get(row.item.aisle) || { count: 0, total: 0 };
    bySection.set(row.item.aisle, { count: s.count + 1, total: s.total + (line || 0) });
  }
  for (const section of document.querySelectorAll(".aisle")) {
    const s = bySection.get(section.dataset.aisle) || { count: 0, total: 0 };
    section.querySelector(".count").textContent = `${s.count} ${s.count === 1 ? "item" : "items"}`;
    section.querySelector(".subtotal").textContent = money(s.total);
  }
  for (const x of extras) total += x.price || 0;
  $("count").textContent = count;
  $("extra-count").textContent = extras.length;
  $("total").textContent = money(total);
  const more = toAdd < count ? " more" : "";
  $("add").textContent = toAdd ? `Add ${toAdd}${more} ${toAdd === 1 ? "item" : "items"} to Walmart cart`
    : count ? "Everything's in your cart" : "Add to Walmart cart";
  $("add").disabled = Boolean(running) || toAdd === 0;
}

// ---- runs: finding products and adding them, either of which you can stop and pick up later ----

async function run(task, body) {
  running = task;
  stopRequested = false;
  session.task = task;
  session.stopped = false;
  showProgress();
  updateTotal();
  let failed = false;
  try {
    await body();
  } catch (e) {
    failed = true;
    setStatus(escapeHtml(e.message), "bad");
  } finally {
    const stopped = stopRequested || failed;
    session.stopped = stopped;
    if (!stopped) session.task = null;
    running = null;
    stopRequested = false;
    if (stopped && !failed) setStatus(stoppedMessage());
    await save();
    showProgress();
    updateTotal();
  }
}

function stoppedMessage() {
  const all = [...rows.values()];
  if (session.task === "finding") {
    return `<strong>Stopped.</strong> Found products for ${all.filter((r) => r.options !== null).length} of ${all.length} items.`;
  }
  const want = all.filter(included);
  return `<strong>Stopped.</strong> Added ${want.filter((r) => r.result?.ok).length} of ${want.length} items to your Walmart cart.`;
}

function showProgress() {
  const p = $("progress");
  if (running) {
    p.innerHTML = `<button id="stop" class="ghost" ${stopRequested ? "disabled" : ""}>${stopRequested ? "Stopping after this item…" : running === "finding" ? "Stop finding products" : "Stop adding"}</button>`;
    $("stop").onclick = () => {
      stopRequested = true;
      if (onStop) onStop();
      showProgress();
    };
  } else if (session && session.task && session.stopped) {
    p.innerHTML = `<button id="pick-up" class="outline">Pick up where I left off</button>
      <button id="restart" class="ghost">Start over</button>`;
    $("pick-up").onclick = pickUp;
    $("restart").onclick = startOver;
  } else if (session) {
    p.innerHTML = `<button id="restart" class="ghost" title="Search every item again for today's prices">Start over</button>`;
    $("restart").onclick = startOver;
  } else p.innerHTML = "";
  updateBar();
}

async function pickUp() {
  setStatus("");
  if (session.task === "finding") await findProducts();
  else await addAll();
}

async function startOver() {
  if (running) return;
  const anyAdded = extras.length || [...rows.values()].some((r) => r.result?.ok);
  const ask = anyAdded
    ? "Start over? Every item is searched again. Anything already added stays in your Walmart cart."
    : "Start over? Every item is searched again for today's prices.";
  if (!confirm(ask)) return;
  await startNew(session.recipeIds);
}

// Search Walmart for every row that hasn't been searched yet, so prices are current and the cheapest one is picked.
function findProducts() {
  return run("finding", async () => {
    const all = [...rows.values()];
    for (const row of all) {
      if (row.options !== null) continue;
      if (stopRequested) return;
      setStatus(`Finding products on Walmart… ${all.filter((r) => r.options !== null).length + 1} of ${all.length}`);
      await searchRow(row);
      await save();
      if (!stopRequested) await sleep(800 + Math.random() * 1200);
    }
    session.checkedAt = Date.now();
    setStatus("");
  });
}

// One job at a time in the Walmart tab: searches and adds would otherwise navigate it under each other.
let queue = Promise.resolve();
function exclusive(job) {
  const next = queue.then(job, job);
  queue = next.catch(() => {});
  return next;
}

// Open a Walmart search and return its products, waiting for you if Walmart asks for a human check.
async function searchWalmart(url) {
  await openInWorker(url);
  let page = await runInWorker(readPageHtml);
  if (page.botCheck) {
    await waitForHuman();
    await openInWorker(url);
    page = await runInWorker(readPageHtml);
  }
  return parseSearchPage(page.html);
}

async function addProduct(product, qty) {
  await openInWorker(product.url);
  let result = await runInWorker(addToCartInPage, [qty]);
  if (result.botCheck) {
    await waitForHuman();
    await openInWorker(product.url);
    result = await runInWorker(addToCartInPage, [qty]);
  }
  return result;
}

// Search Walmart for one row. A query you typed is remembered for that ingredient.
function searchRow(row, typedQuery = null) {
  return exclusive(async () => {
    const query = typedQuery || row.item.query;
    const url = searchUrl(query);
    row.item.query = query; // products are ranked against what was searched
    if (typedQuery) row.item.querySource = "you";
    row.item.searchUrl = url;
    row.el.querySelector(".product").innerHTML = `<span class="muted small">Finding…</span>`;
    row.el.querySelector(".state").textContent = "";
    try {
      const products = await searchWalmart(url);
      if (typedQuery) await storage.saveSearchTerm(row.item.key, typedQuery);
      row.options = productOptions(row.item, products, usual[row.item.key]);
    } catch (e) {
      row.options = e instanceof Stopped ? null : [];
      if (!(e instanceof Stopped)) row.el.querySelector(".state").innerHTML = `<span class="bad">${escapeHtml(e.message)}</span>`;
    }
    row.el.querySelector(".query").textContent = query;
    showOptions(row);
  });
}

// Staples and spices left off the cart stay visible in one list, each with an Add to cart button in case you're running low.
function showLeftOff() {
  const list = [...plan.pantrySkipped, ...plan.spices].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  fillLeftOff($("left-off-items"), list);
  $("left-off").hidden = !list.length;
}

function fillLeftOff(ul, list) {
  ul.innerHTML = "";
  for (const x of list) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="what"><strong>${escapeHtml(x.name)}</strong> <span class="muted small">${escapeHtml(x.amount)}</span></span>`;
    const done = extras.find((e) => e.key === x.key);
    if (done) li.insertAdjacentHTML("beforeend", `<span class="done">✓ In cart · ${money(done.price)}</span>`);
    else {
      const button = document.createElement("button");
      button.className = "outline";
      button.innerHTML = `${PLUS}Add to cart`;
      button.setAttribute("aria-label", `Add ${x.name} to cart`);
      button.addEventListener("click", () => addLeftOff(x, li, button));
      li.appendChild(button);
    }
    ul.appendChild(li);
  }
}

// Find the cheapest match for a left-off item and put it straight in the Walmart cart.
async function addLeftOff(x, li, button) {
  button.disabled = true;
  button.textContent = "Adding…";
  li.querySelector(".err")?.remove();
  try {
    const product = await exclusive(async () => {
      const [best] = productOptions(x, await searchWalmart(x.searchUrl), usual[x.key]);
      if (!best) throw new Error("Nothing found on Walmart.");
      const result = await addProduct(best, best.qty);
      if (!result.ok) throw new Error(result.message);
      return best;
    });
    extras.push({ key: x.key, price: (product.price || 0) * product.qty });
    await storage.saveChoices({ [x.key]: { id: product.id, name: product.name, url: product.url } });
    button.replaceWith(Object.assign(document.createElement("span"), { className: "done", textContent: `✓ In cart · ${money(product.price * product.qty)}` }));
    updateTotal();
    await save();
  } catch (e) {
    button.disabled = false;
    button.innerHTML = `${PLUS}Try again`;
    li.insertAdjacentHTML("beforeend", `<span class="err bad">${escapeHtml(e.message)} <a class="chip-btn" href="${x.searchUrl}" target="_blank">${EXTERNAL}Search Walmart</a></span>`);
  }
}

async function changeSearch(row) {
  if (running) return;
  const typed = prompt(`Search Walmart for "${row.item.name}" using:`, row.item.query);
  if (!typed || !typed.trim() || typed.trim() === row.item.query) return;
  setStatus(`Searching Walmart for "${escapeHtml(typed.trim())}"…`);
  await searchRow(row, typed.trim());
  setStatus("");
  changed();
}

// ---- adding to the cart ----

// Adds every ticked item that isn't in the cart yet, so after a stop it carries on with the rest.
function addAll() {
  return run("adding", () => exclusive(async () => {
    const todo = [...rows.values()].filter((r) => included(r) && !settled(r));
    let ok = 0;
    for (const [i, row] of todo.entries()) {
      if (stopRequested) return;
      const product = selected(row);
      const qty = Math.max(1, Number(row.el.querySelector("input[type=number]").value || 1));
      setStatus(`Adding to your Walmart cart… ${i + 1} of ${todo.length}`);
      row.result = { pending: true, url: product.url };
      showResult(row);
      await save();
      try {
        const result = await addProduct(product, qty);
        row.result = { ok: result.ok, message: result.message, url: product.url };
        if (result.ok) ok++;
      } catch (e) {
        row.result = e instanceof Stopped ? null : { ok: false, message: e.message, url: product.url };
      }
      showResult(row);
      await storage.saveChoices({ [row.item.key]: { id: product.id, name: product.name, url: product.url } });
      await save();
      if (stopRequested) return;
      await sleep(1200 + Math.random() * 1500);
    }
    session.done = true;
    if (workerTabId !== null) {
      await chrome.tabs.update(workerTabId, { url: "https://www.walmart.com/cart", active: true });
      workerTabId = null; // that tab is your cart now; later adds use a fresh background tab
    }
    setStatus(
      `<strong>Added ${ok} of ${todo.length} items.</strong> Your Walmart cart is open in the next tab.
       Review it and check out yourself whenever you're ready.`,
      ok === todo.length ? "ok" : "bad");
  }));
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---- starting, or coming back to, a list ----

async function startNew(ids, auto = false) {
  const chosen = (await storage.recipes()).filter((r) => ids.includes(r.id));
  if (!chosen.length) return showEmpty();
  setStatus("Loading your list…");
  const words = await withTimeout(pullWords(), 5000, storage.suggestedWords());
  plan = buildPlan(chosen, DEFAULT_PANTRY, await storage.searchTerms(), words);
  // Ingredients the rules had to guess at go to the inbox for the next suggestion run. Never holds up shopping.
  askForWords(plan.items).catch(() => {});
  extras = [];
  session = { recipeIds: chosen.map((r) => r.id), task: null, stopped: false, done: false };
  render();
  await save();
  await findProducts();
  // cart.html?recipes=...&auto=1 adds the picks without waiting for the review click.
  if (auto && !session.task && !$("add").disabled) await addAll();
}

function restore(saved) {
  session = saved;
  plan = saved.plan;
  extras = saved.extras || [];
  render();
  for (const row of rows.values()) {
    const s = saved.rows?.[row.item.key];
    if (!s) continue;
    row.options = s.options;
    row.result = s.result;
    // The page closed in the middle of adding this one, so it may or may not be in the cart.
    if (row.result?.pending) {
      row.result = { ok: false, unsure: true, url: row.result.url, message: "This one may already be in your Walmart cart. Check before adding it again." };
    }
    showOptions(row, s);
    showResult(row);
  }
  updateTotal();
}

const sameIds = (a, b) => a.length === b.length && a.every((id) => b.includes(id));

async function main() {
  const params = new URLSearchParams(location.search);
  const ids = (params.get("recipes") || "").split(",").filter(Boolean);
  // From here on the address is plain cart.html, so reloading never starts the list (or an auto add) again.
  if (params.size) history.replaceState(null, "", "cart.html");
  $("add").addEventListener("click", () => addAll());
  usual = await storage.choices();
  const { [KEY]: saved } = await chrome.storage.local.get(KEY);
  workerTabId = saved?.workerTabId ?? null;

  // Shopping for the same recipes again carries on with that list, unless it was already added.
  if (ids.length && !(saved && !saved.done && sameIds(saved.recipeIds, ids))) {
    return startNew(ids, params.get("auto") === "1");
  }
  if (!saved) return showEmpty();
  restore(saved);
  if (saved.task && !saved.stopped) {
    // You left the page partway through; carry on.
    setStatus("");
    return pickUp();
  }
  if (saved.task) setStatus(stoppedMessage());
  showProgress();
}

// The inbox is a nice-to-have here: don't wait long for it.
function withTimeout(promise, ms, fallback) {
  return Promise.race([promise.catch(() => fallback), new Promise((r) => setTimeout(r, ms)).then(() => fallback)]);
}

main();
