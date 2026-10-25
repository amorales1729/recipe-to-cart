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

async function showRecipes() {
  const list = await storage.recipes();
  $("empty").hidden = list.length > 0;
  $("recipe-list").innerHTML = list.map((r) => `
    <li>
      <label><input type="checkbox" value="${escapeHtml(r.id)}"> <strong>${escapeHtml(r.title)}</strong></label>
      <span class="muted small">${r.lines.length} ingredients</span>
      ${r.url ? `<a class="small" href="${escapeHtml(r.url)}" target="_blank">page</a>` : ""}
      <button class="link small show">ingredients</button>
      <button class="link small delete">delete</button>
      <ul class="lines small" hidden>${r.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>
    </li>`).join("");
  $("recipe-list").querySelectorAll(":scope > li").forEach((li, i) => {
    li.querySelector(".show").addEventListener("click", () => { const lines = li.querySelector(".lines"); lines.hidden = !lines.hidden; });
    li.querySelector(".delete").addEventListener("click", async () => {
      if (!confirm(`Delete "${list[i].title}"?`)) return;
      await storage.deleteRecipe(list[i].id);
      showRecipes();
    });
    li.querySelector("input").addEventListener("change", () => { $("shop").disabled = !checked().length; });
  });
  $("shop").disabled = true;
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
