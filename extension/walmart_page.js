// Code that runs inside a walmart.com tab, injected with chrome.scripting.executeScript.
// Each function must be self-contained: Chrome copies its source into the page.

// Never let the extension open these pages. Checkout is always yours to do by hand.
export function isBlockedUrl(url) {
  const path = new URL(url).pathname;
  return /^\/(checkout|payment|payments|place-?order|wallet|account\/wallet|purchase)(\/|$)/i.test(path);
}

export function readPageHtml() {
  return {
    html: document.documentElement.outerHTML,
    botCheck: /robot or human|px-captcha|press & hold/i.test(document.body ? document.body.innerText : ""),
  };
}

// On a product page: get this product into the cart at the right quantity. Every press is checked
// (the + and − buttons appear, the quantity goes up, or the cart count changes) and pressed again if
// Walmart didn't take it, which happens when the page hasn't finished starting up. Running it again
// is safe: an item already in the cart is only topped up to the quantity.
export async function addToCartInPage(quantity, productName = "") {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (find, timeoutMs) => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const found = find();
      if (found) return found;
      await sleep(250);
    }
    return null;
  };
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const nameStart = norm(productName).split(" ").slice(0, 3).join(" ");
  const label = (b) => `${b.getAttribute("aria-label") || ""} ${b.textContent || ""}`.replace(/\s+/g, " ").trim();
  const visible = (b) => !b.disabled && b.offsetParent !== null;
  const buttons = () => Array.from(document.querySelectorAll("button")).filter(visible);
  // Buttons that name a product must name this one, so a "bought together" item further down is left alone.
  const forThis = (text) => !/\bof\b|\s-\s/i.test(text) || !nameStart || norm(text).includes(nameStart);
  const findAdd = () =>
    buttons().find((b) => b.dataset.automationId === "atc") ||
    buttons().find((b) => /^add to cart\b/i.test(label(b)) && forThis(label(b)));
  const findPlus = () => buttons().find((b) => /increase quantity|add one/i.test(label(b)) && forThis(label(b)));
  // The quantity in the cart, read from the stepper's label ("… Current Quantity 2"), when Walmart shows it.
  const inCart = () => {
    for (const b of buttons()) {
      const text = label(b);
      const m = text.match(/current quantity,?\s*(\d+)/i);
      if (m && /(increase|decrease) quantity/i.test(text) && forThis(text)) return Number(m[1]);
    }
    return null;
  };
  // The header's cart link, e.g. "Cart contains 3 items Total Amount $12.34".
  const cartCount = () => {
    for (const el of document.querySelectorAll("a[href*='/cart'], button[aria-label*='art']")) {
      const m = (el.getAttribute("aria-label") || "").match(/cart[^0-9]*?(\d+)\s*items?/i);
      if (m) return Number(m[1]);
    }
    return null;
  };
  const humanCheck = () => /robot or human|press & hold/i.test(document.body.innerText);

  if (humanCheck()) return { ok: false, botCheck: true, message: "Walmart asked to confirm you're human." };

  // Wait for the page to finish loading its buttons.
  const ready = await waitFor(() => findAdd() || findPlus(), 20000);
  if (!ready) {
    if (humanCheck()) return { ok: false, botCheck: true, message: "Walmart asked to confirm you're human." };
    const stock = /out of stock|not available|unavailable/i.test(document.body.innerText) ? "Out of stock at your store" : "No Add to cart button on Walmart's page";
    return { ok: false, message: `${stock}. Open it to pick a substitute.` };
  }

  let have = findAdd() ? 0 : inCart() ?? 1;
  const before = have;

  // Press Add to cart until Walmart shows it's in, up to three tries.
  if (!have) {
    for (let tries = 0; tries < 3 && !have; tries++) {
      const add = findAdd();
      if (!add) break;
      const count = cartCount();
      add.click();
      const took = await waitFor(() => {
        if (findPlus()) return true;
        const now = cartCount();
        return count !== null && now !== null && now > count;
      }, 8000);
      if (took) have = inCart() ?? 1;
      else if (humanCheck()) return { ok: false, botCheck: true, message: "Walmart asked to confirm you're human." };
      else await sleep(1500);
    }
    if (!have) return { ok: false, message: "Walmart didn't take the Add to cart click. Open it to add it yourself." };
  }

  // Then + until the quantity is right. A press counts once the quantity goes up (or, if Walmart
  // doesn't show it, once the button is back), and gets one more try if it didn't.
  while (have < quantity) {
    await sleep(900 + Math.random() * 700);
    let moved = false;
    for (let tries = 0; tries < 2 && !moved; tries++) {
      const plus = await waitFor(findPlus, 8000);
      if (!plus) break;
      const was = inCart();
      plus.click();
      moved = was === null
        ? Boolean(await waitFor(findPlus, 4000))
        : Boolean(await waitFor(() => (inCart() ?? 0) > was, 6000));
    }
    if (!moved) return { ok: false, added: have - before, message: `${have} of ${quantity} in your cart. Walmart didn't take the + press for the rest.` };
    have = inCart() ?? have + 1;
  }
  await sleep(1200);
  if (before >= quantity) return { ok: true, alreadyInCart: true, added: 0, message: `Already in your cart (${before}).` };
  return { ok: true, added: have - before, message: before ? `Topped up to ${have}.` : `Added ${have}.` };
}

// On the cart page: what's in the cart, as [{id, name}], read from each item's link beside its Remove
// button (so "you may also like" items don't count). null if the cart didn't show up in time.
export async function readCartInPage() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const removes = () => Array.from(document.querySelectorAll("button, a")).filter((b) => /^\s*remove\b/i.test(b.textContent || b.getAttribute("aria-label") || ""));
  const end = Date.now() + 20000;
  while (Date.now() < end && !removes().length && !/cart is empty|your cart is empty/i.test(document.body.innerText)) await sleep(500);
  await sleep(1500); // let the rest of the list draw
  const items = [], seen = new Set();
  for (const button of removes()) {
    let box = button.parentElement;
    for (let i = 0; box && i < 10 && !box.querySelector("a[href*='/ip/']"); i++) box = box.parentElement;
    for (const link of box ? box.querySelectorAll("a[href*='/ip/']") : []) {
      const m = link.getAttribute("href").match(/\/ip\/(?:[^/?#]+\/)?(\d+)/);
      if (!m || seen.has(m[1])) continue;
      seen.add(m[1]);
      items.push({ id: m[1], name: (link.textContent || link.getAttribute("aria-label") || "").trim() });
    }
  }
  if (items.length) return items;
  return /cart is empty|your cart is empty/i.test(document.body.innerText) ? [] : null;
}
