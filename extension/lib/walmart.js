// Walmart search-page parsing. Products are read from the JSON Walmart embeds in its
// search page (__NEXT_DATA__), which is more stable than the page's layout.

export const BASE = "https://www.walmart.com";
export const STORE_BRANDS = ["great value", "marketside", "freshness guaranteed", "sam's choice"];
const NEXT_DATA = /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;

export function searchUrl(query) {
  return `${BASE}/search?q=${encodeURIComponent(query).replace(/%20/g, "+")}`;
}

/** Products {id, name, url, image, price, available, sponsored} from a search page's HTML or its __NEXT_DATA__ JSON text. */
export function parseSearchPage(htmlOrJson) {
  let text = htmlOrJson || "";
  const m = text.match(NEXT_DATA);
  if (m) text = m[1];
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const products = [], seen = new Set();
  for (const item of walkItems(data)) {
    const id = String(item.usItemId || "");
    const name = item.name || "";
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    let url = item.canonicalUrl || `/ip/${id}`;
    if (url.startsWith("/")) url = BASE + url;
    products.push({
      id,
      name,
      url: url.split("?")[0],
      image: image(item),
      price: price(item),
      available: available(item),
      sponsored: Boolean(item.isSponsoredFlag),
    });
  }
  return products;
}

function* walkItems(obj) {
  if (Array.isArray(obj)) {
    for (const v of obj) yield* walkItems(v);
  } else if (obj && typeof obj === "object") {
    if ("usItemId" in obj && "name" in obj && (obj.__typename ?? "Product") === "Product") yield obj;
    for (const v of Object.values(obj)) yield* walkItems(v);
  }
}

// A price of 0 means Walmart didn't put one on the search card (items with options, or sold by
// weight), so the text price is used instead, and no price at all beats a made-up $0.
function price(item) {
  const info = item.priceInfo || {};
  const current = info.currentPrice;
  const candidates = [
    current && typeof current === "object" ? current.price : current,
    item.price,
    current && typeof current === "object" ? current.priceString : null,
    info.linePrice, info.linePriceDisplay, info.itemPrice, info.priceRangeString, info.minPrice,
  ];
  for (const v of candidates) {
    const n = typeof v === "number" ? v : typeof v === "string" ? priceText(v) : null;
    if (n > 0) return n;
  }
  return null;
}

/** "$2.97" -> 2.97, "27¢" -> 0.27, "Options from $1.50 – $3.00" -> 1.5. */
export function priceText(text) {
  const t = String(text).replace(/,/g, "");
  const dollars = t.match(/\$\s*(\d+(?:\.\d+)?)/);
  if (dollars) return parseFloat(dollars[1]);
  const cents = t.match(/(\d+(?:\.\d+)?)\s*(?:¢|c\b)/);
  if (cents) return parseFloat(cents[1]) / 100;
  const plain = t.match(/^\s*(\d+(?:\.\d+)?)\s*$/);
  return plain ? parseFloat(plain[1]) : null;
}

function image(item) {
  const url = (item.imageInfo && item.imageInfo.thumbnailUrl) || item.image || item.imageUrl || "";
  return typeof url === "string" && /^https:\/\//.test(url) ? url : "";
}

function available(item) {
  let status = item.availabilityStatusV2;
  status = status && typeof status === "object" ? status.value || "" : item.availabilityStatusDisplayValue || "";
  if (String(status).toLowerCase().replace(/_/g, " ").includes("out of stock")) return false;
  return item.canAddToCart !== false;
}
