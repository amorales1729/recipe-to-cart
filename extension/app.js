import * as inbox from "./inbox.js";
import * as storage from "./lib/storage.js";

const $ = (id) => document.getElementById(id);

function setStatus(html, cls = "") {
  $("status").hidden = !html;
  $("status").className = `card ${cls}`;
  $("status").innerHTML = html;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const icon = (paths) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const LIST = icon(`<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>`);
const EXTERNAL = icon(`<path d="M14 4h6v6"/><path d="M10 14L20 4"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>`);
const TRASH = icon(`<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>`);
const RETRY = icon(`<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>`);
const CHEVRON = icon(`<path d="M6 9l6 6 6-6"/>`);
const CHECK = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;

const COLORS = ["#b5532f", "#c2862b", "#4f7a3a", "#7a4a8c", "#2f6f8f", "#9a3f5c"];
const colorFor = (title) => COLORS[[...title].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 997, 7) % COLORS.length];

// Percent-encode what would end a CSS url('...').
const cssUrl = (url) => url.replace(/['"()\\\s]/g, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`);

function hostname(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

// The page is redrawn whenever recipes arrive, so what you've picked and opened is kept here.
const picked = new Set();
const opened = new Set();
const seen = new Set(); // phone recipes already picked for you once; unpicking one sticks
const STUCK_MS = 2 * 60 * 1000;
let retried = false;

function updateShop() {
  const n = picked.size;
  $("shop").disabled = !n;
  $("shop").textContent = n ? `Shop for ${n} ${n === 1 ? "recipe" : "recipes"}` : "Pick a recipe";
  $("picked").textContent = n ? `${n} selected` : "";
}

// A link from the phone that hasn't become a recipe yet.
function waitingCard(w) {
  const title = w.title || hostname(w.url);
  return `
    <li class="recipe-card waiting" data-waiting="${escapeHtml(w.id)}">
      <div class="photo ${w.error ? "bad" : ""}">
        <div>${w.error ? "" : `<div class="spinner"></div>`}${escapeHtml(w.error || "Reading the recipe…")}</div>
      </div>
      <div class="body">
        <div class="title">${escapeHtml(title)}</div>
        <div class="source">${escapeHtml(hostname(w.url))}</div>
      </div>
      <div class="links">
        <button class="chip-btn retry">${RETRY}Try again</button>
        <a class="icon-btn" href="${escapeHtml(w.url)}" target="_blank" aria-label="Open recipe" title="Open recipe">${EXTERNAL}</a>
        <button class="icon-btn danger remove" aria-label="Remove ${escapeHtml(title)}" title="Remove">${TRASH}</button>
      </div>
    </li>`;
}

function recipeCard(r, isNew) {
  const photo = r.image
    ? `style="background-image: url('${escapeHtml(cssUrl(r.image))}')"`
    : `style="background-color: ${colorFor(r.title)}"`;
  const newTag = isNew ? `<span class="tag green">New</span>` : "";
  return `
    <li class="recipe-card" data-recipe="${escapeHtml(r.id)}">
      <label class="pick">
        <input type="checkbox" value="${escapeHtml(r.id)}" ${picked.has(r.id) ? "checked" : ""} aria-label="Shop for ${escapeHtml(r.title)}">
        <span class="check">${CHECK}</span>
        <div class="photo" ${photo}>${r.image ? "" : escapeHtml(r.title.slice(0, 1))}</div>
        <div class="body">
          <div class="title">${escapeHtml(r.title)}</div>
          <div class="source">${escapeHtml(r.url ? hostname(r.url) : "Pasted recipe")}</div>
        </div>
      </label>
      <div class="tags">
        <button class="chip-btn show" aria-expanded="${opened.has(r.id)}">${LIST}${r.lines.length} ingredients${CHEVRON}</button>
        ${newTag}
      </div>
      <ul class="lines" ${opened.has(r.id) ? "" : "hidden"}>${r.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>
      <div class="links">
        ${r.url ? `<a class="chip-btn" href="${escapeHtml(r.url)}" target="_blank">${EXTERNAL}Open recipe</a>` : ""}
        <button class="icon-btn danger delete" aria-label="Delete ${escapeHtml(r.title)}" title="Delete">${TRASH}</button>
      </div>
    </li>`;
}

async function render() {
  const [list, waiting] = await Promise.all([storage.recipes(), inbox.getWaiting()]);
  const ids = new Set(list.map((r) => r.id));
  const fresh = new Set();
  for (const w of waiting) {
    if (!w.recipeId || !ids.has(w.recipeId)) continue;
    fresh.add(w.recipeId);
    // A recipe that just came from your phone starts out picked.
    if (!seen.has(w.id)) { seen.add(w.id); picked.add(w.recipeId); }
  }
  for (const id of picked) if (!ids.has(id)) picked.delete(id);
  const pending = waiting.filter((w) => !w.recipeId);

  // A read that never finished (Chrome closed, or the background page was stopped) is tried again once.
  if (!retried) {
    retried = true;
    for (const w of pending) if (!w.error && Date.now() - Date.parse(w.added) > STUCK_MS) inbox.retry(w.id);
  }

  $("empty").hidden = list.length + pending.length > 0;
  $("recipe-list").innerHTML = pending.map(waitingCard).join("") + list.map((r) => recipeCard(r, fresh.has(r.id))).join("");

  for (const li of $("recipe-list").querySelectorAll("[data-waiting]")) {
    const id = li.dataset.waiting;
    li.querySelector(".retry").addEventListener("click", () => inbox.retry(id));
    li.querySelector(".remove").addEventListener("click", () => inbox.removeWaiting([id]));
  }
  for (const li of $("recipe-list").querySelectorAll("[data-recipe]")) {
    const r = list.find((x) => x.id === li.dataset.recipe);
    li.querySelector(".show").addEventListener("click", (e) => {
      const lines = li.querySelector(".lines");
      lines.hidden = !lines.hidden;
      e.currentTarget.setAttribute("aria-expanded", String(!lines.hidden));
      if (lines.hidden) opened.delete(r.id); else opened.add(r.id);
    });
    li.querySelector(".delete").addEventListener("click", async () => {
      if (!confirm(`Delete "${r.title}"?`)) return;
      await storage.deleteRecipe(r.id);
      await inbox.clearRecipes([r.id]);
    });
    li.querySelector("input").addEventListener("change", (e) => {
      if (e.target.checked) picked.add(r.id); else picked.delete(r.id);
      updateShop();
    });
  }
  updateShop();
}

// One redraw at a time, so a burst of changes can't leave an older list on screen.
let drawing = Promise.resolve();
const refresh = () => { drawing = drawing.then(render, render); };

$("shop").addEventListener("click", async () => {
  const ids = [...picked];
  if (!ids.length) return;
  await inbox.clearRecipes(ids); // shopped for, so no longer new (and the badge clears)
  location.href = `cart.html?recipes=${ids.join(",")}`;
});

chrome.storage.onChanged.addListener((changes) => { if (changes.recipes || changes.phoneInbox) refresh(); });

const error = new URLSearchParams(location.search).get("error");
if (error) setStatus(escapeHtml(error), "bad");
refresh();
