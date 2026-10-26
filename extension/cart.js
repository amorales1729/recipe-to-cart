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

function render() {
  $("recipes").textContent = plan.recipes.join(" + ");
  const tbody = $("rows");
  tbody.innerHTML = "";
  for (const item of plan.items) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="checkbox" checked aria-label="Include ${item.name}"></td>
      <td>${escapeHtml(item.amount)} ${escapeHtml(item.name)}
        <div class="muted small">Searched: <span class="query">${escapeHtml(item.query)}</span><span class="by">${item.querySource === "suggested" ? " (suggested)" : ""}</span>
          · <button class="link change">change</button>
          · <button class="link have">I always have this</button></div></td>
      <td class="product"><span class="muted">Finding…</span></td>
      <td><input type="number" min="1" value="1"></td>
      <td class="price"></td>
      <td class="state"></td>`;
    tbody.appendChild(tr);
    rows.set(item.key, { item, options: [], el: tr });
    tr.querySelector(".change").addEventListener("click", () => changeSearch(rows.get(item.key)));
    tr.querySelector(".have").addEventListener("click", () => alwaysHave(rows.get(item.key)));
    tr.querySelector("input[type=checkbox]").addEventListener("change", (e) => {
      tr.classList.toggle("skipped", !e.target.checked);
      updateTotal();
    });
  }
  $("list").hidden = false;
  showLeftOff();
}

function showOptions(row) {
  const cell = row.el.querySelector(".product");
  const qty = row.el.querySelector("input[type=number]");
  if (!row.options.length) {
    cell.innerHTML = `<span class="bad">Nothing found.</span> <a href="${row.item.searchUrl}" target="_blank">Search Walmart</a>`;
    row.el.querySelector("input[type=checkbox]").checked = false;
    row.el.classList.add("skipped");
    return;
  }
  const select = document.createElement("select");
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
    row.el.querySelector(".price").textContent = money(o.price);
    updateTotal();
  };
  select.addEventListener("change", apply);
  qty.addEventListener("input", updateTotal);
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
  for (const row of rows.values()) {
    const o = selected(row);
    if (!o || !row.el.querySelector("input[type=checkbox]").checked) continue;
    count++;
    total += (o.price || 0) * Number(row.el.querySelector("input[type=number]").value || 0);
  }
  $("total").textContent = count ? `${count} items, about ${money(total)}` : "";
  $("add").disabled = count === 0;
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

// Search Walmart for one row. A query you typed is remembered for that ingredient.
async function searchRow(row, typedQuery = null) {
  const query = typedQuery || row.item.query;
  const url = searchUrl(query);
  row.item.query = query; // products are ranked against what was searched
  if (typedQuery) {
    row.item.querySource = "you";
    row.el.querySelector(".by").textContent = "";
  }
  row.item.searchUrl = url;
  row.el.querySelector(".product").innerHTML = `<span class="muted">Finding…</span>`;
  row.el.querySelector(".state").textContent = "";
  try {
    await openInWorker(url);
    let page = await runInWorker(readPageHtml);
    if (page.botCheck) {
      await waitForHuman();
      await openInWorker(url);
      page = await runInWorker(readPageHtml);
    }
    if (typedQuery) await storage.saveSearchTerm(row.item.key, typedQuery);
    row.options = productOptions(row.item, parseSearchPage(page.html), usual[row.item.key]);
  } catch (e) {
    row.options = [];
    row.el.querySelector(".state").innerHTML = `<span class="bad">${escapeHtml(e.message)}</span>`;
  }
  row.el.querySelector(".query").textContent = query;
  showOptions(row);
}

// Add this to your pantry staples so it's left off every list from now on.
async function alwaysHave(row) {
  if (adding) return;
  await storage.addToPantry(row.item.name);
  rows.delete(row.item.key);
  row.el.remove();
  plan.pantrySkipped.push({ name: row.item.name, amount: row.item.amount, searchUrl: row.item.searchUrl });
  showLeftOff();
  updateTotal();
}

// Pantry staples and spices stay visible, each with a Walmart link in case you're running low.
function showLeftOff() {
  const li = (x) => `<li><span class="amount">${escapeHtml(x.amount)}</span> <span>${escapeHtml(x.name)}</span>
    <a href="${x.searchUrl}" target="_blank">Find on Walmart</a></li>`;
  $("pantry-items").innerHTML = plan.pantrySkipped.map(li).join("");
  $("spice-list").innerHTML = plan.spices.map(li).join("");
  $("pantry").hidden = !plan.pantrySkipped.length;
  $("spices").hidden = !plan.spices.length;
  $("left-off").hidden = !plan.pantrySkipped.length && !plan.spices.length;
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

async function addAll() {
  adding = true;
  $("add").disabled = true;
  const chosen = {};
  const included = [...rows.values()].filter((r) => selected(r) && r.el.querySelector("input[type=checkbox]").checked);
  let ok = 0;
  for (const [i, row] of included.entries()) {
    const product = selected(row);
    const qty = Math.max(1, Number(row.el.querySelector("input[type=number]").value || 1));
    const state = row.el.querySelector(".state");
    setStatus(`Adding to your Walmart cart… ${i + 1} of ${included.length}`);
    state.textContent = "Adding…";
    try {
      await openInWorker(product.url);
      let result = await runInWorker(addToCartInPage, [qty]);
      if (result.botCheck) {
        await waitForHuman();
        await openInWorker(product.url);
        result = await runInWorker(addToCartInPage, [qty]);
      }
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
  }
  setStatus(
    `<strong>Added ${ok} of ${included.length} items.</strong> Your Walmart cart is open in the next tab.
     Review it and check out yourself whenever you're ready.`,
    ok === included.length ? "ok" : "bad");
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
