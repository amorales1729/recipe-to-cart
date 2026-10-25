// How amounts look to people: "1/3 cup", "1 1/2 cups", "2 tbsp", "28 oz".

// unit as stored -> [singular, plural]
const UNIT_NAMES = {
  teaspoon: ["tsp", "tsp"], tsp: ["tsp", "tsp"], t: ["tsp", "tsp"],
  tablespoon: ["tbsp", "tbsp"], tbsp: ["tbsp", "tbsp"], tbs: ["tbsp", "tbsp"], tbl: ["tbsp", "tbsp"],
  cup: ["cup", "cups"], c: ["cup", "cups"], "c.": ["cup", "cups"],
  "fluid ounce": ["fl oz", "fl oz"], fluid_ounce: ["fl oz", "fl oz"], "fl oz": ["fl oz", "fl oz"],
  ounce: ["oz", "oz"], oz: ["oz", "oz"],
  pound: ["lb", "lbs"], lb: ["lb", "lbs"], lbs: ["lb", "lbs"],
  gram: ["g", "g"], g: ["g", "g"], kilogram: ["kg", "kg"], kg: ["kg", "kg"],
  milliliter: ["ml", "ml"], ml: ["ml", "ml"], liter: ["L", "L"], l: ["L", "L"],
  quart: ["qt", "qt"], qt: ["qt", "qt"], pint: ["pt", "pt"], pt: ["pt", "pt"],
  gallon: ["gal", "gal"], gal: ["gal", "gal"],
};

// Other units ("can", "stalk", "clove", "box") read fine as words; just pluralize them.
const PLURALS = { box: "boxes", bunch: "bunches", pinch: "pinches", dash: "dashes", leaf: "leaves" };

/** 0.333 -> "1/3", 1.5 -> "1 1/2", 2 -> "2". Only kitchen fractions: halves, thirds, quarters, eighths. */
export function formatQuantity(q) {
  let best = null;
  for (const d of [1, 2, 3, 4, 8]) {
    const num = Math.round(q * d);
    if (best === null || Math.abs(num / d - q) < Math.abs(best[0] / best[1] - q)) best = [num, d];
  }
  if (Math.abs(best[0] / best[1] - q) > 0.02) return q.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  const [num, den] = best;
  const whole = Math.floor(num / den), rest = num % den;
  if (rest === 0) return String(whole);
  return whole ? `${whole} ${rest}/${den}` : `${rest}/${den}`;
}

export function formatUnit(unit, quantity) {
  unit = String(unit || "").trim();
  const plural = quantity != null && quantity > 1;
  const names = UNIT_NAMES[unit.toLowerCase()];
  if (names) return plural ? names[1] : names[0];
  const singular = unit.endsWith("s") && !unit.endsWith("ss") ? unit.slice(0, -1) : unit;
  if (!singular) return "";
  return plural ? PLURALS[singular] || singular + "s" : singular;
}

export function formatAmount(quantity, unit) {
  if (quantity == null) return "";
  return `${formatQuantity(quantity)} ${formatUnit(unit, quantity)}`.trim();
}
