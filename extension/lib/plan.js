// The shopping plan for a cart run: what to buy, what to search Walmart for, and which
// product to pick. Pure functions, so the rules are tested without a browser.
import { amountText, buildGroceryList } from "./grocery.js";
import { parseLines } from "./ingredients.js";
import { pickCheapest } from "./rank.js";
import { searchQuery } from "./search.js";
import { packagesNeeded } from "./units.js";
import { STORE_BRANDS, searchUrl } from "./walmart.js";

export const MAX_OPTIONS = 5;

/** recipes: saved recipes {title, lines}. searchTerms: {ingredient key: your own search}. */
export function buildPlan(recipes, pantry, searchTerms = {}) {
  const parsed = recipes.map((r) => ({ title: r.title, ingredients: parseLines(r.lines) }));
  const all = buildGroceryList(parsed, pantry);
  const items = [], pantrySkipped = [], spices = [];
  for (const item of all) {
    if (item.category === "spice") spices.push({ name: item.name, amount: amountText(item) });
    else if (item.skipReason) pantrySkipped.push(item.name);
    else {
      const query = searchTerms[item.key] || searchQuery(item.name, item.unit);
      items.push({ ...item, amount: amountText(item), query, searchUrl: searchUrl(query) });
    }
  }
  return { recipes: recipes.map((r) => r.title), items, pantrySkipped, spices };
}

/** The products to offer for one item, cheapest good match first. `usual` is last time's pick. */
export function productOptions(item, products, usual = null) {
  const qty = (p) => packagesNeeded(item.quantity, item.unit, p.name, item.name);
  const [ranked, nGood] = pickCheapest(products, item.query, STORE_BRANDS, (p) => p.price * qty(p));
  return ranked.slice(0, MAX_OPTIONS).map((p, i) => ({
    ...p,
    qty: qty(p),
    cheapest: i === 0 && nGood > 0,
    usual: Boolean(usual && usual.id === p.id),
  }));
}
