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

// On a product page: press "Add to cart", then "+" until the quantity is right.
export async function addToCartInPage(quantity) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (find, timeoutMs) => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const el = find();
      if (el) return el;
      await sleep(250);
    }
    return null;
  };
  const buttons = () => Array.from(document.querySelectorAll("button"));
  const label = (b) => `${b.getAttribute("aria-label") || ""} ${b.textContent || ""}`.trim();
  const visible = (b) => !b.disabled && b.offsetParent !== null;
  const findAdd = () =>
    buttons().find(
      (b) => visible(b) && (b.dataset.automationId === "atc" || /^\s*add to cart\b/i.test(label(b)))
    );
  const findPlus = () => buttons().find((b) => visible(b) && /increase quantity|add one/i.test(label(b)));

  if (/robot or human|press & hold/i.test(document.body.innerText)) {
    return { ok: false, botCheck: true, message: "Walmart asked to confirm you're human." };
  }

  // Wait for the page to finish loading its buttons.
  const add = await waitFor(() => findAdd() || findPlus(), 15000);
  if (!add) {
    return { ok: false, message: "No Add to cart button (out of stock, or needs a pickup/delivery choice)." };
  }
  if (!findAdd() && findPlus()) {
    return { ok: true, alreadyInCart: true, message: "Already in your cart, left as is." };
  }

  add.click();
  let added = 1;
  for (let i = 1; i < quantity; i++) {
    const plus = await waitFor(findPlus, 8000);
    if (!plus) {
      return { ok: false, added, message: `Added ${added}, but couldn't find the + button for the rest.` };
    }
    await sleep(900 + Math.random() * 700);
    plus.click();
    added++;
  }
  await sleep(1200);
  return { ok: true, added, message: `Added ${added}.` };
}
