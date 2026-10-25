// Pick the right Walmart product. Simple rules, no AI: name overlap, avoid flavored or
// prepared items, then the cheapest good match for the amount the recipe needs.

const AVOID_WORDS = [
  "flavored", "seasoned", "marinated", "sauce", "soup", "mix", "chips", "snack", "candy",
  "dressing", "frozen meal", "kit", "baby food", "dog", "cat", "seeds for planting",
];

// "onions" and "onion" count as the same word.
function words(text) {
  return new Set(
    (String(text).toLowerCase().match(/[a-z]+/g) || []).map((w) =>
      w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w,
    ),
  );
}

/** How well the product's name matches what we searched for, out of 10. */
export function matchScore(product, query) {
  const want = words(query), have = words(product.name);
  if (!want.size) return 0;
  let score = (10 * [...want].filter((w) => have.has(w)).length) / want.size;
  const title = product.name.toLowerCase(), q = String(query).toLowerCase();
  for (const word of AVOID_WORDS) if (title.includes(word) && !q.includes(word)) score -= 4;
  return score;
}

export function scoreProduct(product, query, storeBrands = []) {
  let score = matchScore(product, query);
  if (storeBrands.some((b) => product.name.toLowerCase().startsWith(b))) score += 2;
  if (product.sponsored) score -= 1;
  if (!product.available) score -= 20;
  return score;
}

/** Products ranked best match first. Ties keep the store's own order. */
export function pickProduct(products, query, storeBrands = []) {
  return products
    .map((p, i) => [p, i, scoreProduct(p, query, storeBrands)])
    .sort((a, b) => b[2] - a[2] || a[1] - b[1])
    .map(([p]) => p);
}

// A product counts as the same thing as the best match if it's missing at most about one word of the search.
const CLOSE_MATCH = 3.4;
const MIN_MATCH = 5;

/** In-stock products with a price that match the search about as well as the best one does. */
export function goodMatches(products, query) {
  const usable = products.filter((p) => p.available && p.price != null);
  if (!usable.length) return [];
  const best = Math.max(...usable.map((p) => matchScore(p, query)));
  const floor = Math.max(best - CLOSE_MATCH, MIN_MATCH);
  return usable.filter((p) => matchScore(p, query) >= floor);
}

/**
 * Good matches cheapest first, then everything else best match first.
 * `cost(p)` is what the product costs for the amount needed (price times packages), so a
 * bigger package can win when you'd need two of the small one. Returns [ranked, how many
 * of the leading products are good matches] (0 means none had a price).
 */
export function pickCheapest(products, query, storeBrands = [], cost = (p) => p.price) {
  const ranked = pickProduct(products, query, storeBrands);
  const good = new Set(goodMatches(ranked, query));
  const cheap = ranked.filter((p) => good.has(p)).sort((a, b) => cost(a) - cost(b) || ranked.indexOf(a) - ranked.indexOf(b));
  return [[...cheap, ...ranked.filter((p) => !good.has(p))], cheap.length];
}
