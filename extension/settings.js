import * as inbox from "./inbox.js";
import { alertsTopic, newTopic, notifyPhone } from "./push.js";

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
  $("push").checked = s.push;
  topic = s.pushTopic;
  showPush();
}

let topic = "";

function showPush() {
  if ($("push").checked && !topic) topic = newTopic();
  $("push-details").hidden = !$("push").checked;
  $("alerts-topic").value = topic ? alertsTopic(topic) : "";
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
    push: $("push").checked,
    pushTopic: topic,
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
  let pushError = "";
  try {
    // The inbox needs the channel to ping it; turning instant pickup off stops the pings.
    await inbox.setPushTopic(s, s.push ? s.pushTopic : "");
  } catch (e) {
    pushError = s.push ? ` Instant pickup isn't on yet: ${escapeHtml(e.message)} Paste the latest inbox code into Apps Script and deploy a new version.` : "";
  }
  const when = s.push && !pushError ? "the moment you send them" : "when Chrome starts and every few minutes";
  setStatus((allowed
    ? `Saved. New recipes are picked up ${when}.`
    : "Saved, but without permission to read recipe sites. Links will wait on the Recipes page for you to open them and click the toolbar button.") + pushError,
  allowed && !pushError ? "ok" : "bad");
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

$("push").addEventListener("change", showPush);

$("new-topic").addEventListener("click", () => {
  if (!confirm("Make a new channel? You'll need to subscribe to the new name in the ntfy app, then click Save.")) return;
  topic = newTopic();
  showPush();
});

$("test-alert").addEventListener("click", async () => {
  const saved = await inbox.getSettings();
  if (!saved.push || saved.pushTopic !== topic) return setStatus("Click Save first, then send a test alert.", "bad");
  const sent = await notifyPhone({ title: "Recipe to Cart", message: "Test alert. Cart notes will show up here.", tags: "shopping_cart" });
  setStatus(sent ? "Test alert sent. It should show up in the ntfy app within a few seconds." : "Couldn't reach ntfy.sh. Check your internet connection.", sent ? "ok" : "bad");
});

chrome.storage.onChanged.addListener((changes) => { if (changes.phoneLastCheck) showLastCheck(); });
showSettings();
showLastCheck();
