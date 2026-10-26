// Instant pickup and phone alerts: a ping on the private ntfy.sh channel makes the extension pick up
// a recipe right away (no waiting for the 5-minute check) and fill the cart, and the phone gets
// a "needs you" alert for Walmart's human check and a "cart is ready" alert at the end.
// ntfy.sh, the Google inbox and the recipe site are a local fake; Walmart is routed in the browser.
// Opt in with RTC_E2E=1, like extension.test.js.
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TOPIC = "rtc-testchannelabcdefghij";

let playwright = null;
try {
  playwright = createRequire(import.meta.url)("playwright");
} catch { /* not installed */ }

async function until(cond, seconds) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const PRODUCT_PAGE = `<html><body><h1>Product</h1><span id=q>0</span>
<button data-automation-id="atc" onclick="q.textContent=1;this.remove();p.hidden=false">Add to cart</button>
<button id=p hidden aria-label="Increase quantity, Current Quantity" onclick="q.textContent=+q.textContent+1">+</button></body></html>`;

function searchPage(q) {
  const items = [{ __typename: "Product", usItemId: "1", name: `Great Value ${q}, 32 oz`, canonicalUrl: `/ip/y/1`, price: 2.5 }];
  const data = { props: { pageProps: { initialData: { searchResult: { itemStacks: [{ items }] } } } } };
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`;
}

// One local server for the Apps Script inbox (/exec), a recipe site (/recipe/...) and ntfy.sh.
function fakeInternet() {
  const inbox = [];
  const alerts = [];
  const listeners = new Map(); // topic -> open SSE responses
  let pushTopic = "";
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    let body = "";
    for await (const chunk of req) body += chunk;
    if (url.pathname === "/exec") {
      res.setHeader("Content-Type", "application/json");
      const params = { ...Object.fromEntries(url.searchParams), ...(body ? JSON.parse(body) : {}) };
      if (params.token !== "secret") return res.end(JSON.stringify({ ok: false, error: "bad token" }));
      if (params.action === "push") {
        pushTopic = params.topic;
        return res.end(JSON.stringify({ ok: true, push: Boolean(pushTopic) }));
      }
      if (params.action === "ack") {
        for (const r of inbox) if (params.ids.split(",").includes(r.id)) r.status = "picked up";
        return res.end(JSON.stringify({ ok: true }));
      }
      if (params.action === "words") return res.end(JSON.stringify({ ok: true, words: {} }));
      if (params.action === "ask") return res.end(JSON.stringify({ ok: true, added: 0 }));
      return res.end(JSON.stringify({ ok: true, recipes: inbox.filter((r) => r.status === "waiting") }));
    }
    if (url.pathname.startsWith("/recipe/")) {
      res.setHeader("Content-Type", "text/html");
      return res.end(readFileSync(join(ROOT, "tests/fixtures/italian_chicken_soup.html")));
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    const sse = url.pathname.match(/^\/([\w-]+)\/sse$/);
    if (sse) {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      res.write(`data: ${JSON.stringify({ event: "open", topic: sse[1] })}\n\n`);
      listeners.set(sse[1], [...(listeners.get(sse[1]) || []), res]);
      return;
    }
    if (url.pathname === "/" && req.method === "POST") {
      alerts.push(JSON.parse(body));
      return res.end("{}");
    }
    res.statusCode = 404;
    res.end("not found");
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    resolve({
      base,
      inbox,
      alerts,
      listening: (topic) => (listeners.get(topic) || []).length > 0,
      pushTopic: () => pushTopic,
      // What the Apps Script inbox does when the shortcut sends a link: save it, then ping the channel.
      send(id, path) {
        inbox.push({ id, url: base + path, title: "", added: new Date().toISOString(), status: "waiting" });
        for (const res of listeners.get(pushTopic) || []) res.write(`data: ${JSON.stringify({ event: "message", message: "new recipe" })}\n\n`);
      },
      close: () => { for (const list of listeners.values()) for (const r of list) r.end(); server.close(); },
    });
  }));
}

test("a ping from the inbox fills the cart right away and alerts the phone", { skip: !process.env.RTC_E2E || !playwright, timeout: 240000 }, async () => {
  const net = await fakeInternet();
  // The test copy talks to the fake ntfy.sh, and already has site access (a test can't click Chrome's prompt).
  const tmp = mkdtempSync(join(tmpdir(), "rtc-push-"));
  const ext = join(tmp, "extension");
  cpSync(join(ROOT, "extension"), ext, { recursive: true });
  for (const file of ["push.js", "offscreen.js"]) {
    const path = join(ext, file);
    writeFileSync(path, readFileSync(path, "utf8").replaceAll("https://ntfy.sh", net.base));
  }
  const manifest = JSON.parse(readFileSync(join(ext, "manifest.json"), "utf8"));
  manifest.host_permissions.push("<all_urls>");
  writeFileSync(join(ext, "manifest.json"), JSON.stringify(manifest));

  let botChecks = 0;
  const ctx = await playwright.chromium.launchPersistentContext(join(tmp, "profile"), {
    headless: true,
    ...(process.env.RTC_E2E_CHROMIUM ? { executablePath: process.env.RTC_E2E_CHROMIUM } : { channel: "chromium" }),
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--headless=new"],
  });
  try {
    await ctx.route("https://www.walmart.com/**", (route) => {
      const url = new URL(route.request().url());
      // The first search hits Walmart's human check, which clears by itself a few seconds later (as if you'd done it).
      if (url.pathname === "/search" && !botChecks++) {
        return route.fulfill({ contentType: "text/html", body: `<html><body>Robot or human?<script>setTimeout(() => { document.body.textContent = "thanks"; }, 4000)</script></body></html>` });
      }
      if (url.pathname === "/search") return route.fulfill({ contentType: "text/html", body: searchPage(url.searchParams.get("q")) });
      if (url.pathname.startsWith("/ip/")) return route.fulfill({ contentType: "text/html", body: PRODUCT_PAGE });
      return route.fulfill({ contentType: "text/html", body: "<html><body>cart</body></html>" });
    });
    let [worker] = ctx.serviceWorkers();
    worker = worker || (await ctx.waitForEvent("serviceworker"));
    assert.ok(await until(() => worker.evaluate(() => typeof globalThis.pollPhoneInbox === "function").catch(() => false), 10));
    const extId = worker.url().split("/")[2];
    const storage = () => worker.evaluate(() => chrome.storage.local.get(null));
    const granted = await worker.evaluate(() => chrome.permissions.getAll());
    for (const p of ["background", "offscreen", "power"]) assert.ok(granted.permissions.includes(p), `${p} permission`);

    // Turn it on in Settings: auto mode plus instant pickup. Saving hands the channel to the inbox.
    const settings = await ctx.newPage();
    await settings.goto(`chrome-extension://${extId}/settings.html`);
    await settings.fill("#inbox-url", `${net.base}/exec`);
    await settings.fill("#token", "secret");
    await settings.check("input[name=mode][value=auto]");
    assert.equal(await settings.isVisible("#push-details"), false);
    await settings.check("#push");
    const alertsName = await settings.inputValue("#alerts-topic");
    assert.match(alertsName, /^rtc-[a-z2-9]{24}-alerts$/);
    await settings.click("#save");
    assert.ok(await until(async () => /picked up the moment you send them/.test(await settings.innerText("#status")), 5), await settings.innerText("#status"));
    const topic = (await storage()).phoneSettings.pushTopic;
    assert.equal(alertsName, `${topic}-alerts`);
    assert.equal(net.pushTopic(), topic);
    assert.ok(await until(() => net.listening(topic), 20), "the extension listens on the channel");

    await settings.click("#test-alert");
    assert.ok(await until(() => net.alerts.length === 1, 15));
    assert.equal(net.alerts[0].topic, alertsName);

    // Let the first regular check go by, so only the ping can explain a quick pickup (the next check is 5 minutes away).
    assert.ok(await until(async () => Boolean((await storage()).phoneLastCheck), 30));
    await new Promise((r) => setTimeout(r, 1000));
    const sentAt = Date.now();
    net.send("p1", "/recipe/soup");
    // Seconds, not the 5 minutes the regular check would take (with room for a busy test machine).
    assert.ok(await until(async () => (await storage()).shoppingList?.auto === true, 30), "picked up within seconds of the ping");
    assert.ok(Date.now() - sentAt < 30000);
    assert.equal(net.inbox[0].status, "picked up");

    // Walmart's human check: the phone hears about it, and the list carries on by itself once it clears.
    assert.ok(await until(() => net.alerts.some((a) => /needs you/.test(a.title)), 30), JSON.stringify(net.alerts));
    assert.equal(net.alerts.find((a) => /needs you/.test(a.title)).priority, 4);

    // Everything goes in the cart, then the phone gets the summary with a link to the cart.
    assert.ok(await until(() => net.alerts.some((a) => /cart is ready/.test(a.title)), 200), JSON.stringify(net.alerts));
    const ready = net.alerts.find((a) => /cart is ready/.test(a.title));
    assert.equal(ready.topic, alertsName);
    assert.match(ready.title, /Italian Chicken Soup/);
    assert.match(ready.message, /^11 items added, about \$\d+\.\d\d\. Nothing is bought until you check out\.$/);
    assert.equal(ready.click, "https://www.walmart.com/cart");
    const list = (await storage()).shoppingList;
    assert.equal(list.done, true);
    assert.ok(Object.values(list.rows).every((r) => r.result?.ok), "every item is in the cart");

    // Turning it off stops the listener and tells the inbox to stop pinging.
    await settings.uncheck("#push");
    await settings.click("#save");
    assert.ok(await until(() => net.pushTopic() === "", 5));
    assert.ok(await until(async () => (await worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] }))).length === 0, 5));
  } finally {
    await ctx.close();
    net.close();
  }
});
