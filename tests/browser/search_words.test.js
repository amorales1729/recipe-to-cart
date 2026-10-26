// Suggested Walmart searches: the cart page sends new ingredients to the inbox's "Search words"
// tab and uses the searches suggested there. The inbox is the real apps-script/Code.gs,
// run against a fake Google Sheet. Opt in with RTC_E2E=1, like extension.test.js.
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { fakeGoogle } from "../js/fake_google.js";

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

// Serves Code.gs the way Apps Script does: GET -> doGet, POST -> doPost with the raw body.
function serveInbox(g) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const parameter = Object.fromEntries(url.searchParams);
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const out = req.method === "POST" ? g.ctx.doPost({ parameter, postData: { contents: body } }) : g.ctx.doGet({ parameter });
      res.setHeader("Content-Type", "application/json");
      res.end(out.text);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}/exec`, close: () => server.close() })));
}

test("cart page uses suggested searches and sends new ingredients for the next run", { skip: !process.env.RTC_E2E || !playwright, timeout: 120000 }, async () => {
  const g = fakeGoogle();
  const token = g.ctx.setup();
  // A search for the pasta was already suggested on an earlier run.
  g.post({ action: "ask", token, words: [{ key: "ditalini pasta", name: "Ditalini Pasta", guess: "ditalini pasta" }] });
  g.post({ action: "answer", token, words: { "ditalini pasta": "barilla ditalini pasta" } });
  const inbox = await serveInbox(g);

  const tmp = mkdtempSync(join(tmpdir(), "rtc-words-"));
  const ext = join(tmp, "extension");
  cpSync(join(ROOT, "extension"), ext, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(ext, "manifest.json"), "utf8"));
  manifest.host_permissions.push("<all_urls>"); // the fake recipe site and the local inbox
  writeFileSync(join(ext, "manifest.json"), JSON.stringify(manifest));

  const ctx = await playwright.chromium.launchPersistentContext(join(tmp, "profile"), {
    headless: true,
    ...(process.env.RTC_E2E_CHROMIUM ? { executablePath: process.env.RTC_E2E_CHROMIUM } : { channel: "chromium" }),
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--headless=new"],
  });
  try {
    await ctx.route("https://recipes.example/**", (route) =>
      route.fulfill({ contentType: "text/html", body: readFileSync(join(ROOT, "tests/fixtures/italian_chicken_soup.html"), "utf8") }));
    await ctx.route("https://www.walmart.com/**", (route) => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
    let [worker] = ctx.serviceWorkers();
    worker = worker || (await ctx.waitForEvent("serviceworker"));
    // The worker can be found before background.js has finished running.
    assert.ok(await until(() => worker.evaluate(() => typeof globalThis.pollPhoneInbox === "function").catch(() => false), 10));
    const storage = () => worker.evaluate(() => chrome.storage.local.get(null));
    await worker.evaluate(([inboxUrl, token]) => chrome.storage.local.set({ phoneSettings: { inboxUrl, token, mode: "review" } }), [inbox.url, token]);

    const recipePage = await ctx.newPage();
    await recipePage.goto("https://recipes.example/soup");
    await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: "https://recipes.example/*" });
      await globalThis.shopForTab(tab);
    });
    let cart = null;
    assert.ok(await until(() => (cart = ctx.pages().find((p) => p.url().includes("cart.html"))), 10));
    const row = (name) => cart.locator("#rows .item", { hasText: name });
    assert.ok(await until(async () => (await cart.locator("#rows .item").count()) === 11, 10));
    assert.match(await row("Ditalini Pasta").innerText(), /Searched: barilla ditalini pasta \(suggested\)/);
    assert.match(await row("Cut Up Fryer Chicken").locator(".meta").innerText(), /Searched: whole chicken cut up(?! \(suggested\))/);

    // The other ten went to the inbox with the rules' guess, once.
    const pendingKeys = () => g.get({ action: "pending", token }).words.map((w) => w.key);
    assert.ok(await until(() => pendingKeys().length === 10, 10), String(pendingKeys()));
    assert.ok(!pendingKeys().includes("ditalini pasta"));
    assert.deepEqual(g.get({ action: "pending", token }).words.find((w) => w.key === "cut up fryer chicken"),
      { key: "cut up fryer chicken", name: "Cut Up Fryer Chicken", guess: "whole chicken cut up" });
    assert.equal((await storage()).askedWords.length, 10);

    // The next run answers the chicken; the next inbox check picks it up.
    g.post({ action: "answer", token, words: { "cut up fryer chicken": "whole fryer chicken cut up" } });
    await worker.evaluate(() => globalThis.pollPhoneInbox());
    assert.deepEqual((await storage()).suggestedWords, { "ditalini pasta": "barilla ditalini pasta", "cut up fryer chicken": "whole fryer chicken cut up" });

    // Starting the list over uses it and doesn't send anything twice.
    const rowsBefore = g.sheets["Search words"].rows.length;
    assert.ok(await until(() => cart.locator("#restart").isVisible(), 60), "first search finished");
    cart.once("dialog", (d) => d.accept());
    await cart.click("#restart");
    assert.ok(await until(async () => /Searched: whole fryer chicken cut up \(suggested\)/.test(await row("Cut Up Fryer Chicken").innerText()), 10));
    await cart.waitForTimeout(1000);
    assert.equal(g.sheets["Search words"].rows.length, rowsBefore);
  } finally {
    await ctx.close();
    inbox.close();
  }
});
