// Merge ingredients from one or more recipes into a grocery list.
import { formatAmount } from "./display.js";
import { isSpice } from "./spices.js";
import { convert, sameKind } from "./units.js";

// Staples assumed to be in the kitchen, even before the search-words task has marked any.
// They're left off the shopping list but still shown on it with an Add to cart button.
export const DEFAULT_PANTRY = [
  "water", "ice",
  "oil", "cooking oil", "olive oil", "extra virgin olive oil", "light olive oil",
  "vegetable oil", "canola oil", "cooking spray", "nonstick cooking spray", "nonstick spray",
];

// Plain salt and black pepper are left off every list. Fresh peppers (bell, jalapeno, poblano)
// are groceries; dried ones (cayenne, red pepper flakes) go on the spice list.
const ALWAYS_EXCLUDED = new RegExp(
  String.raw`^(?:(?:kosher|sea|table|fine|coarse|flaky|iodized)\s+)?salt$` +
    String.raw`|^(?:(?:fresh|freshly)\s+)?(?:(?:ground|cracked)\s+)?(?:black\s+)?pepper$`,
);

export function isAlwaysExcluded(name) {
  return ALWAYS_EXCLUDED.test(ingredientKey(name));
}

/** Normalize a name so "Green Bell Peppers" and "green bell pepper" merge. */
export function ingredientKey(name) {
  const words = String(name || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  let last = words[words.length - 1];
  if (last.length > 3) {
    if (last.endsWith("oes")) last = last.slice(0, -2);
    else if (last.endsWith("ies")) last = last.slice(0, -3) + "y";
    else if (last.endsWith("s") && !last.endsWith("ss")) last = last.slice(0, -1);
  }
  words[words.length - 1] = last;
  return words.join(" ");
}

export function amountText(item) {
  return formatAmount(item.quantity, item.unit) || "as needed";
}

/**
 * recipes: [{title, ingredients: [{raw, name, quantity, unit}]}]
 * Returns items {key, name, quantity, unit, sources, skipReason: ""|"pantry", category: "grocery"|"spice"}.
 */
export function buildGroceryList(recipes, pantry = DEFAULT_PANTRY) {
  const pantryKeys = new Set(pantry.map(ingredientKey));
  const items = [];
  for (const recipe of recipes) {
    for (const ing of recipe.ingredients) {
      const key = ingredientKey(ing.name);
      if (!key || isAlwaysExcluded(ing.name)) continue;
      const existing = items.find((it) => it.key === key && canMerge(it, ing.quantity, ing.unit));
      if (!existing) {
        items.push({
          key,
          name: ing.name,
          quantity: ing.quantity ?? null,
          unit: ing.unit || "",
          sources: [recipe.title],
          skipReason: pantryKeys.has(key) ? "pantry" : "",
          category: isSpice(ing.name, ing.unit, ing.raw) ? "spice" : "grocery",
        });
        continue;
      }
      merge(existing, ing.quantity, ing.unit);
      if (!existing.sources.includes(recipe.title)) existing.sources.push(recipe.title);
    }
  }
  return items;
}

function canMerge(item, quantity, unit) {
  if (item.quantity == null || quantity == null) return true;
  if ((item.unit || "").toLowerCase() === (unit || "").toLowerCase()) return true;
  return sameKind(item.unit, unit);
}

function merge(item, quantity, unit) {
  if (quantity == null) return;
  if (item.quantity == null) {
    item.quantity = quantity;
    item.unit = unit || "";
    return;
  }
  if ((item.unit || "").toLowerCase() === (unit || "").toLowerCase()) {
    item.quantity += quantity;
    return;
  }
  const extra = convert(quantity, unit, item.unit);
  if (extra !== null) item.quantity += extra;
}
