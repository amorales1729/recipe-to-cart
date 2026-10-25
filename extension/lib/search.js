// Turn recipe wording into what a grocery store calls the product.
//
// "1 whole Cut Up Fryer Chicken" -> "whole chicken cut up"
// "2 whole Fresh Jalapenos"      -> "jalapeno peppers"
// "1 can Whole Tomatoes"         -> "whole peeled tomatoes canned"
//
// You can also set your own search for any ingredient from the review page; that is
// saved and always wins.

// Checked in order against the cleaned, lowercased name. First match wins. $1 is the first group.
const SYNONYMS = [
  [/\bfryer\b|\bcut[- ]?up (whole )?chicken\b|\bwhole chicken,? cut[- ]?up\b|^chicken,? cut[- ]?up$/, "whole chicken cut up"],
  [/^whole chicken$|^roasting chicken$|^roaster$/, "whole chicken"],
  [/^(boneless,? )?(skinless,? )?chicken breasts?( halves)?$/, "boneless skinless chicken breast"],
  [/^(boneless,? )?(skinless,? )?chicken thighs?$/, "chicken thighs"],
  [/^heavy (whipping )?cream$|^whipping cream$/, "heavy whipping cream"],
  [/^half[- ]and[- ]half$/, "half and half"],
  [/^jalape[nñ]os?( peppers?)?$|^jalape[nñ]o chil(e|i)s?$/, "jalapeno peppers"],
  [/^(green|red|yellow|orange) bell peppers?$/, "$1 bell pepper"],
  [/^bell peppers?$/, "green bell pepper"],
  [/^onions?$|^yellow onions?$|^brown onions?$/, "yellow onion"],
  [/^scallions?$|^green onions?$|^spring onions?$/, "green onions"],
  [/^celery( stalks?| ribs?| sticks?)?$|^stalks? celery$/, "celery"],
  [/^garlic( cloves?)?$|^cloves? (of )?garlic$/, "fresh garlic"],
  [/^ginger( root)?$|^fresh ginger( root)?$/, "fresh ginger root"],
  [/^eggs?$|^large eggs?$/, "large eggs"],
  [/^(unsalted )?butter$/, "$1butter"],
  [/parmesan( cheese)? (shavings|shaved)|^shaved parmesan/, "shaved parmesan cheese"],
  [/^(grated|freshly grated) parmesan( cheese)?$|^parmesan( cheese)?$/, "grated parmesan cheese"],
  [/^whole tomatoes$|^whole peeled tomatoes$/, "whole peeled tomatoes"],
  [/^diced tomatoes$/, "diced tomatoes"],
  [/^tomato paste$/, "tomato paste"],
  [/^(kosher|sea) salt$/, "$1 salt"],
  [/^lemons?$/, "lemon"],
  [/^limes?$/, "lime"],
  [/^potatoes$|^russet potatoes?$/, "russet potatoes"],
  [/^carrots?$/, "carrots"],
];

const HERBS = new Set([
  "oregano", "basil", "thyme", "rosemary", "sage", "dill", "parsley", "cilantro", "mint",
  "chives", "tarragon", "marjoram", "ginger",
]);
const DROP_WORDS = /\b(large|medium|small|med|organic|ripe|good quality|good-quality|best)\b/gi;
const CANNED_UNITS = new Set(["can", "cans", "tin", "tins"]);

/** The text to type into the store's search box for this ingredient. */
export function searchQuery(name, unit = "") {
  let q = String(name).toLowerCase().replace(/\([^)]*\)/g, " "); // drop "(very short pasta)" style notes
  q = q.replace(/[^a-z0-9ñ ,'-]+/g, " ");
  const isHerb = q.split(/\s+/).some((w) => HERBS.has(w));
  q = q.replace(DROP_WORDS, " ");
  if (!isHerb) q = q.replace(/\bfresh\b/g, " ");
  q = q.replace(/\s+/g, " ").replace(/^[ ,-]+|[ ,-]+$/g, "");

  for (const [pattern, replacement] of SYNONYMS) {
    const m = q.match(pattern);
    if (m) {
      q = replacement.replace(/\$(\d)/g, (_, n) => m[n] || "").replace(/\s+/g, " ").trim();
      break;
    }
  }
  if (CANNED_UNITS.has(String(unit || "").toLowerCase()) && !q.includes("canned")) q = `${q} canned`;
  return q || name;
}
