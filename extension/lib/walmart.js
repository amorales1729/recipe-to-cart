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

function price(item) {
  if (typeof item.price === "number") return item.price;
  const info = item.priceInfo || {};
  for (const key of ["currentPrice", "linePrice"]) {
    let v = info[key];
    if (v && typeof v === "object") v = v.price || v.priceString;
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const m = v.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
      if (m) return parseFloat(m[0]);
    }
  }
  return null;
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
