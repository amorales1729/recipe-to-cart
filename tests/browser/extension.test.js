// Full run of the extension in Chromium against fake recipe and Walmart sites.
// Opt in with RTC_E2E=1 (needs Playwright and Chromium; set RTC_E2E_CHROMIUM to use a specific browser).
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const fixture = (name) => readFileSync(join(ROOT, "tests/fixtures", name), "utf8");

let playwright = null;
try {
  playwright = createRequire(import.meta.url)("playwright");
} catch { /* not installed */ }

const PRODUCT_PAGE = `<html><body><h1>Product</h1><span id=q>0</span>
<button data-automation-id="atc" onclick="q.textContent=1;this.remove();p.hidden=false;fetch('/__test/added?id=ID')">Add to cart</button>
<button id=p hidden aria-label="Increase quantity, Current Quantity" onclick="q.textContent=+q.textContent+1;fetch('/__test/added?id=ID')">+</button>
<a href="/checkout">Check out</a></body></html>`;

function searchPage(q) {
  const id = String([...q].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 100000, 7));
  const items = [
    { __typename: "Product", usItemId: id + "1", name: `Fancy Flavored ${q} Snack, 4 oz`, canonicalUrl: `/ip/x/${id}1`, price: 9.99 },
    { __typename: "Product", usItemId: id + "2", name: `Great Value ${q}, 32 oz`, canonicalUrl: `/ip/y/${id}2`, price: 2.5 },
    { __typename: "Product", usItemId: id + "3", name: `Clover Valley ${q}, 16 oz`, canonicalUrl: `/ip/z/${id}3`, price: 1.75 },
  ];
  const data = { props: { pageProps: { initialData: { searchResult: { itemStacks: [{ items }] } } } } };
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`;
}

async function until(cond, seconds, page) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (await cond()) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

test("recipe page to Walmart cart, all inside the extension", { skip: !process.env.RTC_E2E || !playwright, timeout: 240000 }, async () => {
  // The real button relies on activeTab, which a test can't click, so the test copy may read the fake recipe site.
  const tmp = mkdtempSync(join(tmpdir(), "rtc-"));
  const ext = join(tmp, "extension");
  cpSync(join(ROOT, "extension"), ext, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(ext, "manifest.json"), "utf8"));
  manifest.host_permissions.push("https://recipes.example/*");
  writeFileSync(join(ext, "manifest.json"), JSON.stringify(manifest));

  const added = [], checkoutHits = [];
  const ctx = await playwright.chromium.launchPersistentContext(join(tmp, "profile"), {
    headless: true,
    // Extensions need full Chromium, not the stripped-down headless shell.
    ...(process.env.RTC_E2E_CHROMIUM ? { executablePath: process.env.RTC_E2E_CHROMIUM } : { channel: "chromium" }),
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--headless=new"],
  });
  try {
    await ctx.route("https://recipes.example/**", (route) => route.fulfill({ contentType: "text/html", body: fixture("italian_chicken_soup.html") }));
    await ctx.route("https://www.walmart.com/**", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith("/__test/added")) {
        added.push(url.searchParams.get("id"));
        return route.fulfill({ body: "ok" });
      }
      if (url.pathname.startsWith("/checkout")) checkoutHits.push(url.href);
      if (url.pathname === "/search") return route.fulfill({ contentType: "text/html", body: searchPage(url.searchParams.get("q")) });
      if (url.pathname.startsWith("/ip/")) return route.fulfill({ contentType: "text/html", body: PRODUCT_PAGE.replaceAll("ID", url.pathname.split("/").pop()) });
      return route.fulfill({ contentType: "text/html", body: `<html><body>${url.pathname}</body></html>` });
    });

    const recipePage = await ctx.newPage();
    await recipePage.goto("https://recipes.example/italian-chicken-soup");
    let [worker] = ctx.serviceWorkers();
    worker = worker || (await ctx.waitForEvent("serviceworker"));
    const extId = worker.url().split("/")[2];

    // Press the toolbar button on the recipe page.
    await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: "https://recipes.example/*" });
      await globalThis.shopForTab(tab);
    });
    let cart = null;
    assert.ok(await until(() => (cart = ctx.pages().find((p) => p.url().includes(`${extId}/cart.html`))), 10, recipePage));

    const rows = cart.locator("#rows tr");
    const row = (name) => cart.locator("#rows tr", { hasText: name });
    assert.ok(await until(async () => (await rows.count()) === 11 && (await cart.locator("#rows select").count()) === 11
      && (await cart.innerText("#status")).trim() === "", 120, cart), "every item searched");
    assert.match(await cart.innerText("#pantry"), /Olive Oil[\s\S]*Extra Virgin Olive Oil/);
    assert.match(await cart.locator("#pantry a", { hasText: "Find on Walmart" }).first().getAttribute("href"), /walmart\.com\/search\?q=olive/);
    assert.equal(await cart.locator("#spices").isHidden(), true); // nothing from the spice rack in this soup

    // Cheapest for the amount needed, never the flavored snack: one 16 oz box of pasta ($1.75),
    // but two 32 oz broths ($5.00) beat four 16 oz ones ($7.00).
    const picked = (name) => row(name).locator("select option:checked").innerText();
    assert.match(await picked("Ditalini Pasta"), /^Clover Valley ditalini pasta, 16 oz · \$1\.75 · cheapest$/);
    assert.match(await picked("Low Sodium Chicken Broth"), /^Great Value low sodium chicken broth, 32 oz · \$2\.50 · cheapest$/);
    assert.equal(await row("Low Sodium Chicken Broth").locator("input[type=number]").inputValue(), "2");
    assert.match(await row("Cut Up Fryer Chicken").locator(".query").innerText(), /^whole chicken cut up$/);

    // "I always have this" takes celery off the list and remembers it.
    await row("Celery").locator(".have").click();
    assert.ok(await until(async () => (await rows.count()) === 10, 5, cart));
    assert.match(await cart.innerText("#pantry"), /Celery/);

    // Only buy two things in this test.
    for (const box of await cart.locator("#rows input[type=checkbox]").all()) await box.uncheck();
    await row("Ditalini Pasta").locator("input[type=checkbox]").check();
    await row("Low Sodium Chicken Broth").locator("input[type=checkbox]").check();

    // Change a search; the new results replace the old ones.
    cart.once("dialog", (d) => d.accept("barilla ditalini"));
    await row("Ditalini Pasta").locator(".change").click();
    assert.ok(await until(async () => /barilla ditalini/.test(await picked("Ditalini Pasta")), 30, cart));

    await cart.click("#add");
    assert.ok(await until(async () => /Added 2 of 2/.test(await cart.innerText("#status")), 90, cart), await cart.innerText("#status"));
    assert.equal(added.length, 3); // pasta once, broth twice
    assert.ok(await until(() => ctx.pages().some((p) => p.url() === "https://www.walmart.com/cart"), 10, cart));
    assert.deepEqual(checkoutHits, []);

    const saved = await worker.evaluate(() => chrome.storage.local.get(null));
    assert.equal(saved.recipes.length, 1);
    assert.deepEqual(Object.keys(saved.choices).sort(), ["ditalini pasta", "low sodium chicken broth"]);
    assert.deepEqual(saved.searchTerms, { "ditalini pasta": "barilla ditalini" });
    assert.ok(saved.pantry.includes("celery"));

    // The recipes page lists it, and a pasted recipe can be saved.
    const app = await ctx.newPage();
    await app.goto(`chrome-extension://${extId}/app.html`);
    assert.ok(await until(async () => /Italian Chicken Soup/.test(await app.innerText("#recipe-list")), 5, app));
    await app.fill("#paste-text", "Toast\nIngredients\n2 slices bread\n1 tbsp butter");
    await app.click("#paste-save");
    assert.ok(await until(async () => /Toast/.test(await app.innerText("#recipe-list")), 5, app));
    assert.match(await app.innerText("#pantry-list"), /celery/);
  } finally {
    await ctx.close();
  }
});
