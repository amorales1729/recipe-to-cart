import { addToCartInPage, isBlockedUrl, readPageHtml } from "./walmart_page.js";

const API = "http://127.0.0.1:8765";
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const money = (n) => (typeof n === "number" ? `$${n.toFixed(2)}` : "");

let plan = null;
let adding = false;
let workerTabId = null;
const rows = new Map(); // key -> { item, options, el }

function setStatus(html, cls = "") {
  $("status").hidden = !html;
  $("status").className = `card ${cls}`;
  $("status").innerHTML = html;
}

async function api(path, body) {
  const res = await fetch(API + path, body === undefined ? {} : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
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
        <div class="muted small">Searched: <span class="query">${escapeHtml(item.query)}</span>
          · <button class="link change">change</button></div></td>
      <td class="product"><span class="muted">Finding…</span></td>
      <td><input type="number" min="1" value="1"></td>
      <td class="price"></td>
      <td class="state"></td>`;
    tbody.appendChild(tr);
    rows.set(item.key, { item, options: [], el: tr });
    tr.querySelector(".change").addEventListener("click", () => changeSearch(rows.get(item.key)));
    tr.querySelector("input[type=checkbox]").addEventListener("change", (e) => {
      tr.classList.toggle("skipped", !e.target.checked);
      updateTotal();
    });
  }
  $("list").hidden = false;
  if (plan.spices.length) {
    $("spice-list").innerHTML = plan.spices.map((s) => `<li>${escapeHtml(s.amount)} ${escapeHtml(s.name)}</li>`).join("");
    $("spices").hidden = false;
  }
}

function showOptions(row) {
  const cell = row.el.querySelector(".product");
  const qty = row.el.querySelector("input[type=number]");
  if (!row.options.length) {
    cell.innerHTML = `<span class="bad">Nothing found.</span> <a href="${row.item.search_url}" target="_blank">Search Walmart</a>`;
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

// Search Walmart for one row. A query you typed is sent along so the app remembers it.
async function searchRow(row, typedQuery = null) {
  const query = typedQuery || row.item.query;
  const url = `https://www.walmart.com/search?q=${encodeURIComponent(query)}`;
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
    const body = { key: row.item.key, html: page.html };
    if (typedQuery) body.query = typedQuery;
    row.options = (await api("/pick", body)).options;
  } catch (e) {
    row.options = [];
    row.el.querySelector(".state").innerHTML = `<span class="bad">${escapeHtml(e.message)}</span>`;
  }
  row.item.query = query;
  row.item.search_url = url;
  row.el.querySelector(".query").textContent = query;
  showOptions(row);
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
  const chosen = [];
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
    chosen.push({ key: row.item.key, id: product.id, name: product.name, url: product.url });
    await sleep(1200 + Math.random() * 1500);
  }
  try { await api("/choices", { choices: chosen }); await api("/done", {}); } catch { /* app already closed */ }
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
  setStatus("Loading your grocery list…");
  try {
    plan = await api("/plan");
  } catch {
    setStatus(
      `<strong>The Recipe to Cart app isn't running.</strong><br>
       In PowerShell, run <code>rtc cart 1</code> (with your recipe numbers), then
       <button class="link" id="retry">try again</button>.`, "bad");
    $("retry").addEventListener("click", () => location.reload());
    return;
  }
  render();
  $("add").addEventListener("click", addAll);
  await findProducts();
  updateTotal();
}

main();
