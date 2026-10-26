// Instant pickup and phone alerts through ntfy.sh, a free push relay with no account.
// A private channel (a long random name, which works like a password) carries a content-free
// ping from the Google inbox when a recipe arrives, so Chrome picks it up right away instead of
// at the next 5-minute check. A second channel, "<name>-alerts", carries notes back to the ntfy
// app on your phone: the cart is filled, or Walmart needs you at the PC.
import { getSettings } from "./inbox.js";

export const NTFY = "https://ntfy.sh";
export const alertsTopic = (topic) => `${topic}-alerts`;

/** A fresh private channel name. */
export function newTopic() {
  const letters = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `rtc-${[...bytes].map((b) => letters[b % letters.length]).join("")}`;
}

/** The channel in use, or "" when instant pickup is off or the inbox isn't set up. */
export async function activeTopic() {
  const s = await getSettings();
  return s.push && s.pushTopic && s.inboxUrl && s.token ? s.pushTopic : "";
}

// The background worker sleeps between events, so a small hidden page holds the connection open.
const OFFSCREEN = "offscreen.html";

/** Start (or stop) listening for pings, matching the settings. Safe to call often. */
export async function listen() {
  if (!chrome.offscreen) return;
  const topic = await activeTopic();
  const want = topic ? chrome.runtime.getURL(`${OFFSCREEN}?topic=${topic}`) : "";
  const [open] = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (open && open.documentUrl === want) return;
  if (open) await chrome.offscreen.closeDocument();
  if (!want) return;
  await chrome.offscreen.createDocument({
    url: want,
    reasons: ["WORKERS"],
    justification: "Keeps a connection open so recipes sent from your phone are picked up right away.",
  });
}

/** Send a note to the ntfy app on your phone. Quietly does nothing when alerts are off or ntfy can't be reached. */
export async function notifyPhone({ title, message, click = "", priority = "default", tags = "" }) {
  const topic = await activeTopic();
  if (!topic) return false;
  try {
    const res = await fetch(NTFY, {
      method: "POST",
      body: JSON.stringify({ topic: alertsTopic(topic), title, message, click, priority: { high: 4, default: 3 }[priority] || 3, tags: tags ? tags.split(",") : [] }),
      credentials: "omit",
    });
    return res.ok;
  } catch {
    return false;
  }
}
