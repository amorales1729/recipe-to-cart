// Store sections for the cart page, so the list reads like a walk through the store.
// Only for display: nothing about what's bought depends on it.

export const AISLES = [
  ["meat", "Meat & seafood"],
  ["produce", "Fruits & vegetables"],
  ["dairy", "Dairy & eggs"],
  ["bakery", "Bread & bakery"],
  ["pantry", "Pasta, canned & dry goods"],
  ["baking", "Baking & snacks"],
  ["frozen", "Frozen"],
  ["other", "Everything else"],
];

const words = (list) => new RegExp(String.raw`\b(${list.join("|")})\b`);

// Checked in this order, so "chicken broth" is canned goods and "peanut butter" isn't dairy.
const RULES = [
  ["frozen", words(["frozen"])],
  ["pantry", words(["broth", "stock", "bouillon", "canned", "cans?", "jarred", "sauce", "paste", "salsa", "soup",
    "peanut butter", "coconut milk", "evaporated milk", "condensed milk", "beans", "lentils?", "chickpeas?"])],
  ["meat", words(["chicken", "beef", "pork", "turkey", "sausages?", "bacon", "ham", "steaks?", "lamb", "veal", "fish",
    "salmon", "tilapia", "cod", "shrimp", "prawns?", "crab", "meatballs?", "chorizo", "pepperoni", "salami",
    "fryer", "brisket", "ribs?", "roast", "drumsticks?", "thighs?", "breasts?", "wings?", "venison", "tuna"])],
  ["dairy", words(["milk", "cream", "cheese", "butter", "yogurt", "eggs?", "buttermilk", "half and half",
    "parmesan", "mozzarella", "cheddar", "ricotta", "feta", "sour cream", "creme fraiche", "ghee"])],
  ["produce", words(["onions?", "garlic", "peppers?", "jalapenos?", "jalapeños?", "celery", "carrots?", "potato(es)?",
    "tomato(es)?", "lettuce", "spinach", "kale", "cabbage", "broccoli", "cauliflower", "zucchini", "squash",
    "cucumbers?", "mushrooms?", "avocados?", "lemons?", "limes?", "oranges?", "apples?", "bananas?", "berries",
    "strawberries", "blueberries", "raspberries", "grapes?", "peach(es)?", "pears?", "pineapple", "mangos?",
    "cilantro", "parsley", "basil", "oregano", "thyme", "rosemary", "dill", "mint", "chives?", "scallions?",
    "green onions?", "ginger", "corn", "peas", "green beans", "asparagus", "radish(es)?", "beets?", "shallots?",
    "leeks?", "arugula", "zest", "fresh"])],
  ["bakery", words(["bread", "buns?", "rolls?", "tortillas?", "baguettes?", "pitas?", "croissants?", "bagels?"])],
  ["baking", words(["sugar", "flour", "baking", "yeast", "chocolate", "chips", "cocoa", "vanilla", "raisins?",
    "coconut", "pecans?", "walnuts?", "almonds?", "peanuts?", "nuts", "oats", "honey", "syrup", "sprinkles",
    "marshmallows?", "crackers?", "cookies?", "pretzels?", "cornmeal", "cornstarch", "extract"])],
  ["pantry", words(["pasta", "ditalini", "macaroni", "spaghetti", "penne", "noodles?", "rice", "quinoa", "oil",
    "vinegar", "ketchup", "mustard", "mayonnaise", "mayo", "breadcrumbs", "crumbs", "cereal", "mix", "packets?",
    "seasoning", "tomatoes"])],
];

const PACKAGED_UNITS = new Set(["can", "cans", "jar", "jars", "box", "boxes", "package", "packages", "pkg", "packet", "packets"]);

/** The aisle id for an ingredient, from its name and unit. */
export function aisleFor(name, unit = "") {
  const text = String(name || "").toLowerCase();
  if (PACKAGED_UNITS.has(String(unit || "").toLowerCase()) && !RULES[2][1].test(text)) return "pantry";
  for (const [aisle, re] of RULES) if (re.test(text)) return aisle;
  return "other";
}
