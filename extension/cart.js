import { AISLES } from "./lib/aisles.js";
import { buildPlan, productOptions } from "./lib/plan.js";
import * as storage from "./lib/storage.js";
import { parseSearchPage, searchUrl } from "./lib/walmart.js";
import { askForWords, pullWords } from "./inbox.js";
import { addToCartInPage, isBlockedUrl, readPageHtml } from "./walmart_page.js";

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const money = (n) => (typeof n === "number" ? `$${n.toFixed(2)}` : "");

let plan = null;
let usual = {}; // last time's product per ingredient
let adding = false;
let workerTabId = null;
const rows = new Map(); // key -> { item, options, el }
const extras = []; // left-off items added from the kitchen section: {key, price}

function setStatus(html, cls = "") {
  $("status").hidden = !html;
  $("status").className = `card ${cls}`;
  $("status").innerHTML = html;
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
  await new Promise((r) => $("resume").addEventListener("click", r, { once: true }));
  setStatus("Continuing…");
}

// ---- building the list ----

const PHOTO = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#a3a79e" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/></svg>`;
const CHEVRON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;

function render() {
  $("recipes").innerHTML = plan.recipes.map((t) => `<span class="pill">${escapeHtml(t)}</span>`).join("");
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
  $("list").hidden = false;
  showLeftOff();
}

function itemRow(item) {
  const el = document.createElement("div");
  el.className = "item";
  el.dataset.key = item.key;
  el.innerHTML = `
    <input type="checkbox" class="include" checked aria-label="Include ${escapeHtml(item.name)}">
    <div class="thumb">${PHOTO}</div>
    <div class="info">
      <div><span class="ing">${escapeHtml(item.name)}</span><span class="need">${item.amount === "as needed" ? "As needed" : `Need ${escapeHtml(item.amount)}`} · ${escapeHtml(item.sources.join(", "))}</span></div>
      <div class="product"><span class="muted small">Finding…</span></div>
      <div class="meta">
        <span class="tags"></span>
        <span class="muted">Searched: <span class="query">${escapeHtml(item.query)}</span><span class="by">${item.querySource === "suggested" ? " (suggested)" : ""}</span></span>
        <span class="sep" aria-hidden="true">·</span><button class="link change">Change search</button>
        <span class="sep" aria-hidden="true">·</span><button class="link have">I always have this</button>
      </div>
    </div>
    <div class="qty">
      <button class="dec" aria-label="One less ${escapeHtml(item.name)}">−</button>
      <input type="number" min="1" value="1" aria-label="How many ${escapeHtml(item.name)}">
      <button class="inc" aria-label="One more ${escapeHtml(item.name)}">+</button>
    </div>
    <div class="price"><div class="line-total"></div><div class="each"></div></div>
    <div class="state"></div>`;
  const row = { item, options: [], el };
  rows.set(item.key, row);
  const qty = el.querySelector("input[type=number]");
  const step = (d) => { qty.value = Math.max(1, Number(qty.value || 1) + d); updateTotal(); };
  el.querySelector(".dec").addEventListener("click", () => step(-1));
  el.querySelector(".inc").addEventListener("click", () => step(1));
  qty.addEventListener("input", updateTotal);
  el.querySelector(".change").addEventListener("click", () => changeSearch(row));
  el.querySelector(".have").addEventListener("click", () => alwaysHave(row));
  el.querySelector(".include").addEventListener("change", (e) => {
    el.classList.toggle("skipped", !e.target.checked);
    updateTotal();
  });
  return el;
}

function showOptions(row) {
  const cell = row.el.querySelector(".product");
  const qty = row.el.querySelector("input[type=number]");
  if (!row.options.length) {
    cell.innerHTML = `<span class="bad small">Nothing found.</span> <a class="small" href="${row.item.searchUrl}" target="_blank">Search Walmart</a>`;
    row.el.querySelector(".include").checked = false;
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
    const tags = [o.cheapest && `<span class="tag green">Cheapest</span>`, o.usual && `<span class="tag blue">Your usual</span>`,
      row.item.querySource === "suggested" && `<span class="tag">Suggested search</span>`];
    row.el.querySelector(".tags").innerHTML = tags.filter(Boolean).join(" ");
    updateTotal();
  };
  select.addEventListener("change", apply);
  cell.innerHTML = "";
  cell.appendChild(select);
  apply();
}

function selected(row) {
  const select = row.el.querySelector("select");
  return select ? row.options[select.value] : null;
}

function updateTotal() {
  let total = 0, count = 0;
  const bySection = new Map();
  for (const row of rows.values()) {
    const o = selected(row);
    const n = Number(row.el.querySelector("input[type=number]").value || 0);
    const line = o ? (o.price || 0) * n : 0;
    row.el.querySelector(".line-total").textContent = o ? money(line) : "";
    row.el.querySelector(".each").textContent = o && n > 1 ? `${money(o.price)} each` : "";
    if (!o || !row.el.querySelector(".include").checked) continue;
    count++;
    total += line;
    const s = bySection.get(row.item.aisle) || { count: 0, total: 0 };
    bySection.set(row.item.aisle, { count: s.count + 1, total: s.total + line });
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
  $("add").textContent = count ? `Add ${count} ${count === 1 ? "item" : "items"} to Walmart cart` : "Add to Walmart cart";
  $("add").disabled = adding || count === 0;
}

// Every item is searched each time so prices are current and the cheapest one is picked.
async function findProducts() {
  const todo = [...rows.values()];
  for (const [i, row] of todo.entries()) {
    setStatus(`Finding products on Walmart… ${i + 1} of ${todo.length}`);
    await searchRow(row);
    await sleep(800 + Math.random() * 1200);
  }
  setStatus("");
}

// One job at a time in the Walmart tab: searches and adds would otherwise navigate it under each other.
let queue = Promise.resolve();
function exclusive(job) {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
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
    if (typedQuery) {
      row.item.querySource = "you";
      row.el.querySelector(".by").textContent = "";
    }
    row.item.searchUrl = url;
    row.el.querySelector(".product").innerHTML = `<span class="muted small">Finding…</span>`;
    row.el.querySelector(".state").textContent = "";
    try {
      const products = await searchWalmart(url);
      if (typedQuery) await storage.saveSearchTerm(row.item.key, typedQuery);
      row.options = productOptions(row.item, products, usual[row.item.key]);
    } catch (e) {
      row.options = [];
      row.el.querySelector(".state").innerHTML = `<span class="bad">${escapeHtml(e.message)}</span>`;
    }
    row.el.querySelector(".query").textContent = query;
    showOptions(row);
  });
}

// Add this to your pantry staples so it's left off every list from now on.
async function alwaysHave(row) {
  if (adding) return;
  await storage.addToPantry(row.item.name);
  rows.delete(row.item.key);
  const section = row.el.closest(".aisle");
  row.el.remove();
  if (section && !section.querySelector(".item")) section.remove();
  plan.pantrySkipped.push(row.item);
  showLeftOff();
  updateTotal();
}

// Pantry staples and spices stay visible, each with an Add to cart button in case you're running low.
function showLeftOff() {
  fillLeftOff($("pantry-items"), plan.pantrySkipped);
  fillLeftOff($("spice-list"), plan.spices);
  $("pantry").hidden = !plan.pantrySkipped.length;
  $("spices").hidden = !plan.spices.length;
  $("left-off").hidden = !plan.pantrySkipped.length && !plan.spices.length;
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
      button.textContent = "Add to cart";
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
  } catch (e) {
    button.disabled = false;
    button.textContent = "Try again";
    li.insertAdjacentHTML("beforeend", `<span class="err bad">${escapeHtml(e.message)} <a href="${x.searchUrl}" target="_blank">Search Walmart</a></span>`);
  }
}

async function changeSearch(row) {
  if (adding) return;
  const typed = prompt(`Search Walmart for "${row.item.name}" using:`, row.item.query);
  if (!typed || !typed.trim() || typed.trim() === row.item.query) return;
  setStatus(`Searching Walmart for "${escapeHtml(typed.trim())}"…`);
  await searchRow(row, typed.trim());
  setStatus("");
  updateTotal();
}

// ---- adding to the cart ----

function addAll() {
  adding = true;
  $("add").disabled = true;
  return exclusive(async () => {
    const chosen = {};
    const included = [...rows.values()].filter((r) => selected(r) && r.el.querySelector(".include").checked);
    let ok = 0;
    for (const [i, row] of included.entries()) {
      const product = selected(row);
      const qty = Math.max(1, Number(row.el.querySelector("input[type=number]").value || 1));
      const state = row.el.querySelector(".state");
      setStatus(`Adding to your Walmart cart… ${i + 1} of ${included.length}`);
      state.textContent = "Adding…";
      try {
        const result = await addProduct(product, qty);
        state.innerHTML = result.ok
          ? `<span class="ok">✓ ${escapeHtml(result.message)}</span>`
          : `<span class="bad">${escapeHtml(result.message)}</span> <a href="${product.url}" target="_blank">Open</a>`;
        if (result.ok) ok++;
      } catch (e) {
        state.innerHTML = `<span class="bad">${escapeHtml(e.message)}</span> <a href="${product.url}" target="_blank">Open</a>`;
      }
      chosen[row.item.key] = { id: product.id, name: product.name, url: product.url };
      await sleep(1200 + Math.random() * 1500);
    }
    await storage.saveChoices(chosen);
    if (workerTabId !== null) {
      await chrome.tabs.update(workerTabId, { url: "https://www.walmart.com/cart", active: true });
      workerTabId = null; // that tab is your cart now; later adds use a fresh background tab
    }
    setStatus(
      `<strong>Added ${ok} of ${included.length} items.</strong> Your Walmart cart is open in the next tab.
       Review it and check out yourself whenever you're ready.`,
      ok === included.length ? "ok" : "bad");
  });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function main() {
  const ids = (new URLSearchParams(location.search).get("recipes") || "").split(",").filter(Boolean);
  const chosen = (await storage.recipes()).filter((r) => ids.includes(r.id));
  if (!chosen.length) {
    setStatus(`<strong>No recipes picked.</strong> Open a recipe page and click the Recipe to Cart button,
      or pick some on <a href="app.html">your recipes</a>.`, "bad");
    return;
  }
  setStatus("Loading your list…");
  const words = await withTimeout(pullWords(), 5000, storage.suggestedWords());
  plan = buildPlan(chosen, await storage.pantry(), await storage.searchTerms(), words);
  // Ingredients the rules had to guess at go to the inbox for the next suggestion run. Never holds up shopping.
  askForWords(plan.items).catch(() => {});
  usual = await storage.choices();
  render();
  $("add").addEventListener("click", addAll);
  await findProducts();
  updateTotal();
  // cart.html?recipes=...&auto=1 adds the picks without waiting for the review click.
  if (new URLSearchParams(location.search).get("auto") === "1" && !$("add").disabled) await addAll();
}

// The inbox is a nice-to-have here: don't wait long for it.
function withTimeout(promise, ms, fallback) {
  return Promise.race([promise.catch(() => fallback), new Promise((r) => setTimeout(r, ms)).then(() => fallback)]);
}

main();
