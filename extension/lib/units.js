// Unit conversion and "how many packages do I need" math.

// Rough grams per milliliter, used only when a recipe gives volume and the store sells by weight.
const DENSITY_G_PER_ML = {
  flour: 0.53,
  sugar: 0.85,
  "brown sugar": 0.9,
  "powdered sugar": 0.5,
  butter: 0.96,
  rice: 0.85,
  oats: 0.38,
  cheese: 0.45,
  parmesan: 0.4,
  honey: 1.42,
  "peanut butter": 1.08,
};
const DEFAULT_DENSITY = 1.0; // water-like: broth, milk, cream, oil

// Measurable units -> [kind, size in ml or g].
const MEASURES = {
  teaspoon: ["volume", 4.92892], tablespoon: ["volume", 14.7868], cup: ["volume", 236.588],
  "fluid ounce": ["volume", 29.5735], pint: ["volume", 473.176], quart: ["volume", 946.353],
  gallon: ["volume", 3785.41], milliliter: ["volume", 1], liter: ["volume", 1000],
  ounce: ["mass", 28.3495], pound: ["mass", 453.592], gram: ["mass", 1], kilogram: ["mass", 1000],
};

const ALIASES = {
  tsp: "teaspoon", t: "teaspoon", teaspoons: "teaspoon",
  tbsp: "tablespoon", tbs: "tablespoon", tbl: "tablespoon", tablespoons: "tablespoon",
  c: "cup", cups: "cup",
  "fl oz": "fluid ounce", "fluid ounces": "fluid ounce", fluid_ounce: "fluid ounce",
  pints: "pint", pt: "pint", quarts: "quart", qt: "quart", gallons: "gallon", gal: "gallon",
  ml: "milliliter", milliliters: "milliliter", l: "liter", liters: "liter", litre: "liter", litres: "liter",
  oz: "ounce", ounces: "ounce", lb: "pound", lbs: "pound", pounds: "pound",
  g: "gram", grams: "gram", kg: "kilogram", kilograms: "kilogram",
};

// Recipe words that mean "one of the thing" rather than a measurable amount.
const PACKAGE_UNITS = new Set([
  "can", "cans", "box", "boxes", "jar", "jars", "package", "packages", "bag", "bags", "bottle", "bottles",
]);

export function canonicalUnit(unit) {
  const u = String(unit || "").trim().toLowerCase().replace(/\.$/, "").replace("fl. oz", "fl oz");
  return ALIASES[u] || u;
}

/** {kind: "volume"|"mass", amount: ml or g} for measurable units, or null for counts like "2 stalks". */
export function toQuantity(amount, unit) {
  const m = MEASURES[canonicalUnit(unit)];
  return m ? { kind: m[0], amount: amount * m[1] } : null;
}

const SIZE = new RegExp(
  String.raw`(\d+(?:\.\d+)?)\s*-?\s*(fl\.?\s*oz\.?|fluid ounces?|oz\.?|ounces?|lbs?\.?|pounds?|` +
    String.raw`g|grams?|kg|ml|l|liters?|litres?|gal(?:lon)?s?|qt|quarts?|pt|pints?|ct|count|pk|pack)(?![a-z])`,
  "gi",
);

/** Package size in a product title: "Heavy Cream, 32 fl oz" -> [32, "fl oz"]. */
export function parseSize(productName) {
  const matches = [...String(productName || "").matchAll(SIZE)];
  if (!matches.length) return null;
  const m = matches[matches.length - 1]; // sizes are usually at the end of the title
  let unit = m[2].toLowerCase().replace(/\.$/, "").replace(/\s+/g, " ").replace("fl. oz", "fl oz").replace("fl.oz", "fl oz").replace("floz", "fl oz");
  unit = {
    ounce: "oz", ounces: "oz", "fluid ounce": "fl oz", "fluid ounces": "fl oz",
    lbs: "lb", pound: "lb", pounds: "lb", gram: "g", grams: "g",
    liter: "l", liters: "l", litre: "l", litres: "l",
    gal: "gallon", gals: "gallon", gallons: "gallon",
    quart: "qt", quarts: "qt", pint: "pt", pints: "pt",
    count: "ct", pk: "ct", pack: "ct",
  }[unit] || unit;
  return [parseFloat(m[1]), unit];
}

function densityFor(name) {
  const lowered = String(name || "").toLowerCase();
  for (const [key, d] of Object.entries(DENSITY_G_PER_ML)) if (lowered.includes(key)) return d;
  return DEFAULT_DENSITY;
}

/** How many of this product to put in the cart. Always at least 1, always rounds up. */
export function packagesNeeded(needAmount, needUnit, productName, ingredientName = "") {
  if (needAmount == null || needAmount <= 0) return 1;
  const unitWord = String(needUnit || "").toLowerCase();
  const size = parseSize(productName);
  const need = toQuantity(needAmount, needUnit);

  if (size === null) {
    // Unknown package size: buy one per counted item ("2 cans"), else one package.
    return need === null && PACKAGE_UNITS.has(unitWord) ? Math.max(1, Math.ceil(needAmount)) : 1;
  }
  let [n, unit] = size;
  if (unit === "ct") {
    // "6 ct" eggs for "8 eggs" -> 2 packs. Measured needs ("1 cup") just get one pack.
    return need === null ? Math.max(1, Math.ceil(needAmount / n)) : 1;
  }
  // Liquids are often labeled "32 oz" when they mean fluid ounces (broth, milk, juice).
  if (unit === "oz" && need && need.kind === "volume") unit = "fl oz";
  const pkg = toQuantity(n, unit);
  if (pkg === null || need === null) {
    // "1 onion" vs a "3 lb bag" -> one bag. "2 cans" vs a single "28 oz" can -> two.
    return need === null && PACKAGE_UNITS.has(unitWord) ? Math.max(1, Math.ceil(needAmount)) : 1;
  }
  let ratio;
  if (need.kind === pkg.kind) ratio = need.amount / pkg.amount;
  else if (need.kind === "volume") ratio = (need.amount * densityFor(ingredientName)) / pkg.amount;
  else ratio = need.amount / densityFor(ingredientName) / pkg.amount;
  // Small tolerance so 32.0001 oz doesn't become two packs because of float noise.
  return Math.max(1, Math.ceil(ratio - 1e-6));
}

/** Add `amount unit` to an existing total in `toUnit`, or null if they can't be combined. */
export function convert(amount, fromUnit, toUnit) {
  const a = toQuantity(amount, fromUnit), b = toQuantity(1, toUnit);
  return a && b && a.kind === b.kind ? a.amount / b.amount : null;
}

export function sameKind(unitA, unitB) {
  const a = toQuantity(1, unitA), b = toQuantity(1, unitB);
  return Boolean(a && b && a.kind === b.kind);
}
