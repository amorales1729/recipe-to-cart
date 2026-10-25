// Recipes sent from the phone: the extension picks them up from a fake Google inbox,
// reads each recipe, shows a badge, and (in auto mode) opens the cart on its own.
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

// Stands in for both the Apps Script web app (/exec) and a recipe site (/recipe/...).
function fakeInternet() {
  const inbox = [];
  const acked = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/exec") {
      res.setHeader("Content-Type", "application/json");
      if (url.searchParams.get("token") !== "secret") return res.end(JSON.stringify({ ok: false, error: "bad token" }));
      if (url.searchParams.get("action") === "ack") {
        const ids = url.searchParams.get("ids").split(",");
        acked.push(...ids);
        for (const r of inbox) if (ids.includes(r.id)) r.status = "picked up";
        return res.end(JSON.stringify({ ok: true, acked: ids.length }));
      }
      return res.end(JSON.stringify({ ok: true, recipes: inbox.filter((r) => r.status === "waiting") }));
    }
    if (url.pathname.startsWith("/recipe/")) {
      res.setHeader("Content-Type", "text/html");
      return res.end(readFileSync(join(ROOT, "tests/fixtures/italian_chicken_soup.html")));
    }
    res.statusCode = 404;
    res.end("not found");
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    resolve({
      base,
      inbox,
      acked,
      send: (id, path) => inbox.push({ id, url: base + path, title: "", added: new Date().toISOString(), status: "waiting" }),
      close: () => server.close(),
    });
  }));
}

test("recipes from the phone are picked up and wait for review, or fill the cart in auto mode", { skip: !process.env.RTC_E2E || !playwright, timeout: 120000 }, async () => {
  // A test can't click Chrome's permission prompt, so the test copy already has site access.
  const tmp = mkdtempSync(join(tmpdir(), "rtc-phone-"));
  const ext = join(tmp, "extension");
  cpSync(join(ROOT, "extension"), ext, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(ext, "manifest.json"), "utf8"));
  manifest.host_permissions.push("<all_urls>");
  writeFileSync(join(ext, "manifest.json"), JSON.stringify(manifest));

  const net = await fakeInternet();
  const ctx = await playwright.chromium.launchPersistentContext(join(tmp, "profile"), {
    headless: true,
    ...(process.env.RTC_E2E_CHROMIUM ? { executablePath: process.env.RTC_E2E_CHROMIUM } : { channel: "chromium" }),
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--headless=new"],
  });
  try {
    await ctx.route("https://www.walmart.com/**", (route) => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
    let [worker] = ctx.serviceWorkers();
    worker = worker || (await ctx.waitForEvent("serviceworker"));
    const extId = worker.url().split("/")[2];
    const storage = () => worker.evaluate(() => chrome.storage.local.get(null));
    const badge = () => worker.evaluate(() => chrome.action.getBadgeText({}));

    // Not set up yet: polling does nothing.
    assert.deepEqual(await worker.evaluate(() => globalThis.pollPhoneInbox()), { added: [], error: null });
    assert.ok(await worker.evaluate(() => chrome.alarms.get("phone-inbox")), "polls on a timer");

    // Set up through the settings page; a wrong token is reported.
    const phone = await ctx.newPage();
    await phone.goto(`chrome-extension://${extId}/phone.html`);
    await phone.fill("#inbox-url", `${net.base}/exec`);
    await phone.fill("#token", "wrong");
    await phone.click("#test");
    assert.ok(await until(async () => /token doesn't match/.test(await phone.innerText("#status")), 5));
    await phone.fill("#token", "secret");
    await phone.click("#test");
    assert.ok(await until(async () => /Connected\. 0 recipes waiting/.test(await phone.innerText("#status")), 5));
    await phone.click("#save");
    assert.ok(await until(async () => /Saved\./.test(await phone.innerText("#status")), 5), await phone.innerText("#status"));
    assert.equal((await storage()).phoneSettings.mode, "review");

    // Review mode: the recipe is saved and waits with a badge.
    net.send("a1", "/recipe/soup");
    const first = await worker.evaluate(() => globalThis.pollPhoneInbox());
    assert.equal(first.error, null);
    assert.equal(first.added.length, 1);
    let saved = await storage();
    assert.equal(saved.phoneInbox.length, 1);
    assert.equal(saved.phoneInbox[0].title, "Italian Chicken Soup");
    assert.equal(saved.recipes.length, 1);
    assert.equal(saved.phoneInbox[0].recipeId, saved.recipes[0].id);
    assert.deepEqual(net.acked, ["a1"]);
    assert.equal(await badge(), "1");
    assert.ok(!ctx.pages().some((p) => p.url().includes("cart.html")), "review mode doesn't open the cart");

    // Polling again doesn't add it twice.
    assert.equal((await worker.evaluate(() => globalThis.pollPhoneInbox())).added.length, 0);

    // It shows on the phone page; shopping opens the cart page for it and clears the badge.
    assert.ok(await until(async () => /Italian Chicken Soup/.test(await phone.innerText("#waiting")), 5));
    await phone.click("#shop");
    assert.ok(await until(() => phone.url().includes(`cart.html?recipes=${saved.recipes[0].id}`), 5), phone.url());
    assert.ok(await until(async () => (await badge()) === "", 5));
    assert.equal((await storage()).phoneInbox.length, 0);

    // Auto mode: a new recipe opens the cart page by itself, with auto-add on.
    await worker.evaluate(() => chrome.storage.local.get("phoneSettings").then(({ phoneSettings }) =>
      chrome.storage.local.set({ phoneSettings: { ...phoneSettings, mode: "auto" } })));
    net.send("b2", "/recipe/other-soup");
    await worker.evaluate(() => globalThis.pollPhoneInbox());
    assert.ok(await until(() => ctx.pages().some((p) => /cart\.html\?recipes=r\d+&auto=1$/.test(p.url())), 10),
      ctx.pages().map((p) => p.url()).join("\n"));
    saved = await storage();
    assert.equal(saved.phoneInbox.length, 0);
    assert.equal(saved.recipes.length, 2);
    assert.equal(await badge(), "");
  } finally {
    await ctx.close();
    net.close();
  }
});
