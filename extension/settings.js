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

async function showSettings() {
  const s = await inbox.getSettings();
  $("inbox-url").value = s.inboxUrl;
  $("token").value = s.token;
  document.querySelector(`input[name=mode][value=${s.mode}]`).checked = true;
}

async function showLastCheck() {
  const { phoneLastCheck: last } = await chrome.storage.local.get("phoneLastCheck");
  $("last-check").innerHTML = !last ? "" : last.error
    ? `<span class="bad">Last check failed: ${escapeHtml(last.error)}</span>`
    : `Last checked ${escapeHtml(new Date(last.at).toLocaleTimeString())}`;
}

function formSettings() {
  return {
    inboxUrl: $("inbox-url").value.trim(),
    token: $("token").value.trim(),
    mode: document.querySelector("input[name=mode]:checked").value,
  };
}

$("check").addEventListener("click", async () => {
  setStatus("Checking your inbox…");
  await inbox.retryFailed();
  const { added, error } = await inbox.poll();
  if (error) setStatus(escapeHtml(error), "bad");
  else if (added.length) setStatus(`Picked up ${added.length} new recipe${added.length > 1 ? "s" : ""}. <a href="app.html">See your recipes</a>`, "ok");
  else setStatus("No new recipes.", "ok");
});

$("save").addEventListener("click", async () => {
  const s = formSettings();
  try { new URL(s.inboxUrl); } catch { return setStatus("That inbox URL doesn't look right. Copy it from Deploy > Manage deployments.", "bad"); }
  // Must run straight from the click: Chrome only shows its permission prompt for a user action.
  const allowed = await chrome.permissions.request(inbox.ALL_SITES).catch(() => false);
  await inbox.saveSettings(s);
  setStatus(allowed
    ? "Saved. New recipes are picked up when Chrome starts and every few minutes."
    : "Saved, but without permission to read recipe sites. Links will wait on the Recipes page for you to open them and click the toolbar button.",
  allowed ? "ok" : "bad");
  if (allowed) inbox.retryFailed();
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

chrome.storage.onChanged.addListener((changes) => { if (changes.phoneLastCheck) showLastCheck(); });
showSettings();
showLastCheck();
