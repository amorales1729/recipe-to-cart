// Turn ingredient lines like "2 lbs beef chuck, cubed" into {name, quantity, unit, prep}.
// Plain rules that run inside the extension: no AI, nothing sent anywhere.

const FRACTIONS = {
  "½": "1/2", "⅓": "1/3", "⅔": "2/3", "¼": "1/4", "¾": "3/4", "⅕": "1/5", "⅖": "2/5", "⅗": "3/5",
  "⅘": "4/5", "⅙": "1/6", "⅚": "5/6", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8",
};
const WORD_NUMBERS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, half: 0.5, dozen: 12,
};

// Unit words -> how they're stored. Single letters are case sensitive: T is tbsp, t is tsp.
const UNITS = [
  [/^(?:cups?|c)\b\.?/i, "cup"],
  [/^(?:tablespoons?|tbsps?|tbs|tbl|T)\b\.?/, "tablespoon"],
  [/^(?:Tablespoons?|TBSP|Tbsps?|Tbs|Tbl)\b\.?/, "tablespoon"],
  [/^(?:teaspoons?|tsps?|t)\b\.?/, "teaspoon"],
  [/^(?:Teaspoons?|TSP|Tsps?)\b\.?/, "teaspoon"],
  [/^(?:fluid ounces?|fl\.? ?oz)\b\.?/i, "fluid ounce"],
  [/^(?:ounces?|oz)\b\.?/i, "ounce"],
  [/^(?:pounds?|lbs?)\b\.?/i, "pound"],
  [/^(?:kilograms?|kgs?)\b\.?/i, "kilogram"],
  [/^(?:grams?|g)\b\.?/i, "gram"],
  [/^(?:milliliters?|millilitres?|ml)\b\.?/i, "milliliter"],
  [/^(?:liters?|litres?|l)\b\.?/i, "liter"],
  [/^(?:pints?|pt)\b\.?/i, "pint"],
  [/^(?:quarts?|qt)\b\.?/i, "quart"],
  [/^(?:gallons?|gal)\b\.?/i, "gallon"],
  [/^(?:cans?|tins?)\b/i, "can"],
  [/^box(?:es)?\b/i, "box"],
  [/^(?:packages?|pkgs?)\b\.?/i, "package"],
  [/^packets?\b/i, "packet"],
  [/^envelopes?\b/i, "envelope"],
  [/^jars?\b/i, "jar"],
  [/^bags?\b/i, "bag"],
  [/^bottles?\b/i, "bottle"],
  [/^containers?\b/i, "container"],
  [/^cartons?\b/i, "carton"],
  [/^cloves?\b/i, "clove"],
  [/^(?:stalks?|ribs?)\b/i, "stalk"],
  [/^heads?\b/i, "head"],
  [/^bunch(?:es)?\b/i, "bunch"],
  [/^sprigs?\b/i, "sprig"],
  [/^slices?\b/i, "slice"],
  [/^(?:-?inch )?(?:pieces?|knobs?)\b/i, "piece"],
  [/^pinch(?:es)?\b/i, "pinch"],
  [/^dash(?:es)?\b/i, "dash"],
  [/^sticks?\b/i, "stick"],
  [/^handfuls?\b/i, "handful"],
];
const MEASURED = new Set([
  "cup", "tablespoon", "teaspoon", "fluid ounce", "ounce", "pound", "kilogram", "gram",
  "milliliter", "liter", "pint", "quart", "gallon",
]);
const PACKAGE_WORD = /^(cans?|box(es)?|packages?|bags?|jars?|bottles?|containers?|cartons?|tins?)\s+/i;

const NUM = String.raw`\d+(?:\s+|-)\d+/\d+|\d+/\d+|\d+(?:\.\d+)?|\.\d+`;
const QUANTITY = new RegExp(String.raw`^(${NUM})(?:\s*(?:-|–|—|to|or)\s*(${NUM}))?\s*`, "i");
const WORD_QUANTITY = new RegExp(String.raw`^(${Object.keys(WORD_NUMBERS).join("|")})\s+`, "i");
const SIZE_WORD = /^(?:large|medium|small|big|heaping|level|scant|generous)\s+/i;

const FILLER_PREFIXES = /^(whole|large|medium|small|med\.?)\s+/i;
const SIZE_PREFIXES = /^(large|medium|small|med\.?)\s+/i;
const TO_TASTE = /\bto taste\b|\bas needed\b/i;
const OPTIONAL = /\boptional\b/i;
const TRAILING_NOTES = /\s+(?:to taste|as needed|for (?:serving|garnish|topping|the pan)|optional|divided|or more|plus more\b.*|if desired)\b.*$/i;
const LEADING_PREP = /^((?:(?:finely|coarsely|roughly|thinly|freshly)\s+)?(?:minced|chopped|diced|sliced|crushed|cubed))\s+/i;

function toNumber(text) {
  text = text.trim();
  const mixed = text.match(/^(\d+)(?:\s+|-)(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = text.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  return Number(text);
}

/** Drop "whole"/size words that recipes put before counted items ("1 whole Medium Onion").
 * Keep "whole" when the item has a unit, since "1 can Whole Tomatoes" is a product name. */
export function cleanName(name, stripWhole = true) {
  const pattern = stripWhole ? FILLER_PREFIXES : SIZE_PREFIXES;
  name = name.trim().replace(/^[ ,.;:]+|[ ,.;:]+$/g, "");
  for (;;) {
    const stripped = name.replace(pattern, "");
    if (stripped === name) return name;
    name = stripped;
  }
}

function normalize(line) {
  let s = line.replace(/[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/g, (c) => ` ${FRACTIONS[c]}`).replace(/⁄/g, "/");
  s = s.replace(/^\s*(?:[-*•▪●▢□☐]|\d+[.)](?=\s))\s*/, "");
  return s.replace(/\s+/g, " ").trim();
}

/** Parse one ingredient line. Returns several for lines like "Salt and pepper". */
export function parseLine(line) {
  const raw = String(line || "").trim();
  if (!raw) return [];
  let s = normalize(raw);
  if (!s || (/:$/.test(s) && !/\d/.test(s))) return []; // "For the sauce:" headings
  const toTaste = TO_TASTE.test(s), optional = OPTIONAL.test(s);

  // "Juice of 1 lemon", "zest of 2 limes"
  const juice = s.match(new RegExp(String.raw`^(?:the\s+)?(?:juice|zest|juice and zest) of\s+(${NUM}|a|an|one|two|three|half)\s+(?:a\s+)?(.+)$`, "i"));
  if (juice) {
    const q = WORD_NUMBERS[juice[1].toLowerCase()] ?? toNumber(juice[1]);
    return [{ raw, name: cleanName(juice[2].split(",")[0]), quantity: q, unit: "", prep: "", toTaste, optional }];
  }

  let quantity = null, unit = "";
  let m = s.match(QUANTITY);
  if (m) {
    // Ranges like "2-3 carrots" use the upper bound so we never buy too little.
    quantity = toNumber(m[2] || m[1]);
    s = s.slice(m[0].length);
  } else if ((m = s.match(WORD_QUANTITY))) {
    quantity = WORD_NUMBERS[m[1].toLowerCase()];
    s = s.slice(m[0].length);
  }
  s = s.replace(/^x\s+/i, "").replace(/^\([^)]*\)\s*/, ""); // "1 (28-ounce) can"
  const withSize = s.replace(SIZE_WORD, "");
  for (const [pattern, name] of UNITS) {
    const u = withSize.match(pattern);
    if (u && (withSize.length === u[0].length || /^[\s,]/.test(withSize.slice(u[0].length)))) {
      unit = name;
      s = withSize.slice(u[0].length).trim();
      break;
    }
  }
  s = s.replace(/^of\s+/i, "").replace(/^\([^)]*\)\s*/, "");
  if (unit) {
    // "1 can (28-ounce) Can Whole Tomatoes", "12 oz bag frozen peas"
    const again = s.match(PACKAGE_WORD);
    if (again && (MEASURED.has(unit) || again[1].toLowerCase().startsWith(unit))) s = s.slice(again[0].length);
  }

  s = s.replace(/\bboneless,\s*skinless\b/gi, "boneless skinless");
  let prep = "";
  const comma = s.indexOf(",");
  if (comma >= 0) {
    prep = s.slice(comma + 1).trim();
    s = s.slice(0, comma);
  }
  s = s.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(TRAILING_NOTES, "");
  const lead = !["can", "jar", "box", "package", "bag", "bottle", "container", "carton"].includes(unit) && s.match(LEADING_PREP);
  if (lead && s.length > lead[0].length) {
    prep = [lead[1], prep].filter(Boolean).join(", ");
    s = s.slice(lead[0].length);
  }

  // "Salt and freshly ground pepper" is two things. "Butter or margarine": take the first.
  let names = [s];
  const sp = s.match(/^(.*\bsalt)\s+(?:and|&)\s+(.*\bpepper)$/i);
  if (sp) names = [sp[1], sp[2]];
  else if (/\s+or\s+/i.test(s)) names = [s.split(/\s+or\s+/i)[0]];
  names = names.map((n) => cleanName(n, !unit)).filter(Boolean);
  if (!names.length) names = [cleanName(normalize(raw))];
  return names.map((name) => ({ raw, name, quantity, unit, prep, toTaste, optional }));
}

export function parseLines(lines) {
  return lines.flatMap(parseLine);
}
