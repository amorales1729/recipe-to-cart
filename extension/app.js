import { fromText } from "./lib/recipe.js";
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

const checked = () => [...document.querySelectorAll("#recipe-list input:checked")].map((c) => c.value);
const COLORS = ["#b5532f", "#c2862b", "#4f7a3a", "#7a4a8c", "#2f6f8f", "#9a3f5c"];
const colorFor = (title) => COLORS[[...title].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 997, 7) % COLORS.length];

// Percent-encode what would end a CSS url('...').
const cssUrl = (url) => url.replace(/['"()\\\s]/g, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`);

function source(r) {
  if (!r.url) return "Pasted recipe";
  try { return new URL(r.url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function updateShop() {
  const n = checked().length;
  $("shop").disabled = !n;
  $("shop").textContent = n ? `Shop for ${n} ${n === 1 ? "recipe" : "recipes"}` : "Pick a recipe";
  $("picked").textContent = n ? `${n} selected` : "";
}

async function showRecipes() {
  const list = await storage.recipes();
  $("empty").hidden = list.length > 0;
  $("recipe-list").innerHTML = list.map((r) => {
    const photo = r.image
      ? `style="background-image: url('${escapeHtml(cssUrl(r.image))}')"`
      : `style="background-color: ${colorFor(r.title)}"`;
    return `
    <li class="recipe-card">
      <label class="pick">
        <input type="checkbox" value="${escapeHtml(r.id)}" aria-label="Shop for ${escapeHtml(r.title)}">
        <div class="photo" ${photo}>${r.image ? "" : escapeHtml(r.title.slice(0, 1))}</div>
        <div class="body">
          <div class="title">${escapeHtml(r.title)}</div>
          <div class="source">${escapeHtml(source(r))}</div>
          <div class="tags">
            <span class="tag">${r.lines.length} ingredients</span>
            ${r.fromPhone ? `<span class="tag blue">From your iPhone</span>` : ""}
          </div>
        </div>
      </label>
      <div class="links">
        <button class="link show">Ingredients</button>
        ${r.url ? `<a href="${escapeHtml(r.url)}" target="_blank">Open recipe</a>` : ""}
        <button class="link delete">Delete</button>
      </div>
      <ul class="lines" hidden>${r.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>
    </li>`;
  }).join("");
  $("recipe-list").querySelectorAll(":scope > li").forEach((li, i) => {
    li.querySelector(".show").addEventListener("click", () => { const lines = li.querySelector(".lines"); lines.hidden = !lines.hidden; });
    li.querySelector(".delete").addEventListener("click", async () => {
      if (!confirm(`Delete "${list[i].title}"?`)) return;
      await storage.deleteRecipe(list[i].id);
      showRecipes();
    });
    li.querySelector("input").addEventListener("change", updateShop);
  });
  updateShop();
}

async function showPantry() {
  const items = await storage.pantry();
  $("pantry-list").innerHTML = items.map((p) => `<li>${escapeHtml(p)} <button class="link" title="Remove">×</button></li>`).join("");
  $("pantry-list").querySelectorAll("li").forEach((li, i) => {
    li.querySelector("button").addEventListener("click", async () => {
      await storage.removeFromPantry(items[i]);
      showPantry();
    });
  });
}

$("shop").addEventListener("click", () => {
  location.href = `cart.html?recipes=${checked().join(",")}`;
});

$("paste-save").addEventListener("click", async () => {
  try {
    const recipe = fromText($("paste-text").value, $("paste-title").value.trim() || null);
    await storage.saveRecipe(recipe);
    $("paste-text").value = $("paste-title").value = "";
    setStatus(`Saved <strong>${escapeHtml(recipe.title)}</strong> with ${recipe.lines.length} ingredients.`, "ok");
    showRecipes();
  } catch (e) {
    setStatus(escapeHtml(e.message), "bad");
  }
});

$("pantry-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("pantry-add").value.trim();
  if (!name) return;
  await storage.addToPantry(name);
  $("pantry-add").value = "";
  showPantry();
});

const error = new URLSearchParams(location.search).get("error");
if (error) setStatus(escapeHtml(error), "bad");
showRecipes();
showPantry();
