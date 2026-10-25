import * as inbox from "./inbox.js";

const $ = (id) => document.getElementById(id);

function setStatus(html, cls = "") {
  $("status").hidden = !html;
  $("status").className = `card ${cls}`;
  $("status").innerHTML = html;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const checkedIds = () => [...document.querySelectorAll("#waiting input:checked")].map((c) => c.value);

async function showWaiting() {
  const list = await inbox.getWaiting();
  $("empty").hidden = list.length > 0;
  $("waiting").innerHTML = list.map((r) => `
    <li>
      <label><input type="checkbox" value="${escapeHtml(r.id)}" ${r.recipeId ? "checked" : "disabled"}>
        <strong>${escapeHtml(r.title || new URL(r.url).hostname)}</strong></label>
      <a class="small" href="${escapeHtml(r.url)}" target="_blank">page</a>
      <span class="muted small">sent ${escapeHtml(new Date(r.added).toLocaleString())}</span>
      <button class="link small remove">remove</button>
      ${r.recipeId ? "" : `<div class="small ${r.error ? "bad" : "muted"}" style="flex-basis:100%">${escapeHtml(r.error || "Reading the recipe…")}</div>`}
    </li>`).join("");
  $("waiting").querySelectorAll(":scope > li").forEach((li, i) => {
    li.querySelector(".remove").addEventListener("click", async () => { await inbox.removeWaiting([list[i].id]); showWaiting(); });
    li.querySelector("input").addEventListener("change", updateShop);
  });
  updateShop();
  const { phoneLastCheck: last } = await chrome.storage.local.get("phoneLastCheck");
  $("last-check").innerHTML = !last ? "" : last.error
    ? `<span class="bad">Last check failed: ${escapeHtml(last.error)}</span>`
    : `Last checked ${escapeHtml(new Date(last.at).toLocaleTimeString())}`;
}

function updateShop() { $("shop").disabled = !checkedIds().length; }

async function showSettings() {
  const s = await inbox.getSettings();
  $("inbox-url").value = s.inboxUrl;
  $("token").value = s.token;
  document.querySelector(`input[name=mode][value=${s.mode}]`).checked = true;
}

function formSettings() {
  return {
    inboxUrl: $("inbox-url").value.trim(),
    token: $("token").value.trim(),
    mode: document.querySelector("input[name=mode]:checked").value,
  };
}

$("shop").addEventListener("click", async () => {
  const ids = new Set(checkedIds());
  const ready = (await inbox.getWaiting()).filter((r) => ids.has(r.id) && r.recipeId);
  if (!ready.length) return;
  await inbox.removeWaiting(ready.map((r) => r.id));
  location.href = inbox.cartPageUrl(ready.map((r) => r.recipeId));
});

$("check").addEventListener("click", async () => {
  setStatus("Checking your inbox…");
  await inbox.retryFailed();
  const { added, error } = await inbox.poll();
  if (error) setStatus(escapeHtml(error), "bad");
  else setStatus(added.length ? `Picked up ${added.length} new recipe${added.length > 1 ? "s" : ""}.` : "No new recipes.", "ok");
  showWaiting();
});

$("save").addEventListener("click", async () => {
  const s = formSettings();
  try { new URL(s.inboxUrl); } catch { return setStatus("That inbox URL doesn't look right. Copy it from Deploy > Manage deployments.", "bad"); }
  // Must run straight from the click: Chrome only shows its permission prompt for a user action.
  const allowed = await chrome.permissions.request(inbox.ALL_SITES).catch(() => false);
  await inbox.saveSettings(s);
  setStatus(allowed
    ? "Saved. New recipes are picked up when Chrome starts and every few minutes."
    : "Saved, but without permission to read recipe sites. Links will wait here for you to open them and click the toolbar button.",
  allowed ? "ok" : "bad");
  if (allowed) inbox.retryFailed().then(showWaiting);
});

$("test").addEventListener("click", async () => {
  setStatus("Testing…");
  try {
    const n = await inbox.testConnection(formSettings());
    setStatus(`Connected. ${n} recipe${n === 1 ? "" : "s"} waiting in the inbox.`, "ok");
  } catch (e) {
    setStatus(escapeHtml(e.message), "bad");
  }
});

chrome.storage.onChanged.addListener((changes) => { if (changes.phoneInbox || changes.phoneLastCheck) showWaiting(); });
showSettings();
showWaiting();
