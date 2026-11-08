// The shopping plan for a cart run: what to buy, what to search Walmart for, and which
// product to pick. Pure functions, so the rules are tested without a browser.
import { aisleFor } from "./aisles.js";
import { amountText, buildGroceryList } from "./grocery.js";
import { parseLines } from "./ingredients.js";
import { pickCheapest } from "./rank.js";
import { searchQuery } from "./search.js";
import { approxWeight, packagesNeeded } from "./units.js";
import { STORE_BRANDS, searchUrl } from "./walmart.js";

export const MAX_OPTIONS = 5;

// What the search-words task writes instead of a search for a staple most kitchens already have.
export const PANTRY_WORD = "(pantry)";

/**
 * recipes: saved recipes {title, lines}. searchTerms: {ingredient key: your own search}.
 * suggestedWords: {ingredient key: suggested search}. Yours win, then the suggestions, then the rules.
 * A suggestion of PANTRY_WORD leaves the item off as a pantry staple, unless you've set your own search.
 */
export function buildPlan(recipes, pantry, searchTerms = {}, suggestedWords = {}) {
  const parsed = recipes.map((r) => ({ title: r.title, ingredients: parseLines(r.lines) }));
  const all = buildGroceryList(parsed, pantry);
  const items = [], pantrySkipped = [], spices = [];
  for (const item of all) {
    const suggested = suggestedWords[item.key] === PANTRY_WORD ? "" : suggestedWords[item.key];
    const [query, querySource] = searchTerms[item.key] ? [searchTerms[item.key], "you"]
      : suggested ? [suggested, "suggested"]
      : [searchQuery(item.name, item.unit), "rules"];
    // Left-off items can still be added from the cart page, in case you're running low.
    const leftOff = { key: item.key, name: item.name, quantity: item.quantity, unit: item.unit,
      amount: amountText(item), query, searchUrl: searchUrl(query) };
    if (item.category === "spice") spices.push(leftOff);
    else if (item.skipReason) pantrySkipped.push(leftOff);
    else if (!searchTerms[item.key] && suggestedWords[item.key] === PANTRY_WORD) pantrySkipped.push(leftOff);
    else {
      const weight = approxWeight(item.quantity, item.unit, item.name);
      const amount = weight ? `${amountText(item)} (${weight})` : amountText(item);
      items.push({ ...item, aisle: aisleFor(item.name, item.unit), amount, query, querySource, searchUrl: searchUrl(query) });
    }
  }
  return { recipes: recipes.map((r) => r.title), items, pantrySkipped, spices };
}

/** The products to offer for one item, cheapest good match first. `usual` is last time's pick. */
export function productOptions(item, products, usual = null) {
  const qty = (p) => packagesNeeded(item.quantity, item.unit, p.name, item.name);
  // Fresh produce and meat: frozen, canned and jarred versions only if the recipe asks for them.
  // A recipe that says frozen gets frozen, not canned.
  const fresh = ["produce", "meat"].includes(item.aisle || aisleFor(item.name, item.unit)) || /\bfrozen\b/i.test(item.name);
  // And frozen even if the search wording dropped the word.
  const query = /\bfrozen\b/i.test(item.name) && !/\bfrozen\b/i.test(item.query) ? `frozen ${item.query}` : item.query;
  let [ranked, nGood] = pickCheapest(products, query, STORE_BRANDS, (p) => p.price * qty(p), fresh);
  // Products Walmart shows no price for can't be compared, so they're only offered when nothing has one.
  if (ranked.some((p) => p.price > 0)) ranked = ranked.filter((p) => p.price > 0);
  return ranked.slice(0, MAX_OPTIONS).map((p, i) => ({
    ...p,
    qty: qty(p),
    cheapest: i === 0 && nGood > 0,
    usual: Boolean(usual && usual.id === p.id),
  }));
}
