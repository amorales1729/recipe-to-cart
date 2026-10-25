// Sort spice-rack items onto their own list, away from the grocery list and the cart.
//
// Spice rack (own list):   ground cumin, paprika, garlic powder, 1 tsp oregano, bay leaves,
//                          red pepper flakes, Italian seasoning, 2 tbsp taco seasoning
// Groceries (to the cart): a packet of taco seasoning, gravy mix, onion soup mix,
//                          fresh oregano, cilantro, garlic cloves, fresh ginger

// Always spice rack, whatever the amount (unless sold as a packet or mix, see below).
const SPICES = new Set([
  "allspice", "anise", "star anise", "cardamom", "cayenne", "cayenne pepper", "celery salt",
  "celery seed", "chili powder", "chile powder", "chipotle powder", "ancho chile powder",
  "cinnamon", "ground cinnamon", "cloves", "ground cloves", "whole cloves", "coriander",
  "ground coriander", "cumin", "ground cumin", "cumin seed", "curry powder", "garam masala",
  "fennel seed", "garlic powder", "granulated garlic", "garlic salt", "onion powder",
  "onion salt", "ground ginger", "ground mustard", "dry mustard", "mustard powder",
  "mustard seed", "nutmeg", "ground nutmeg", "paprika", "smoked paprika", "sweet paprika",
  "red pepper flake", "red pepper flakes", "crushed red pepper", "crushed red pepper flake",
  "chili flake", "chili flakes", "white pepper", "black peppercorn", "peppercorn", "saffron",
  "sesame seed", "turmeric", "ground turmeric", "bay leaf", "bay leave", "italian seasoning",
  "cajun seasoning", "creole seasoning", "old bay", "old bay seasoning", "poultry seasoning",
  "seasoned salt", "lemon pepper", "everything bagel seasoning", "pumpkin pie spice",
  "apple pie spice", "herbes de provence", "za atar", "sumac", "msg", "steak seasoning",
  "taco seasoning", "fajita seasoning", "ranch seasoning", "chili seasoning", "cream of tartar",
  "dill weed", "dried dill", "dried basil", "dried oregano", "dried thyme", "dried rosemary",
  "dried parsley", "dried sage", "dried marjoram", "dried tarragon", "rubbed sage", "ground sage",
  "dried chive", "ground thyme",
]);

// Herbs that are dried (spice rack) when measured in teaspoons and not called fresh.
const DRIED_BY_DEFAULT = new Set(["oregano", "thyme", "rosemary", "sage", "marjoram", "tarragon", "basil", "dill"]);
const SMALL_UNITS = new Set(["teaspoon", "tablespoon", "pinch", "dash", "tsp", "tbsp", "t"]);

// Sold as a store item even though it's a seasoning.
const PACKET = /\b(packets?|envelopes?|pkgs?|packages?|mix|gravy|sachets?)\b/i;
const PACKET_UNITS = new Set([
  "packet", "packets", "envelope", "envelopes", "package", "packages", "pkg",
  "ounce", "oz", "box", "boxes", "jar", "jars",
]);

function key(name) {
  const words = name.toLowerCase().replace(/[^a-z ]+/g, " ").split(/\s+/).filter(Boolean);
  const last = words[words.length - 1];
  if (last && last.length > 3 && last.endsWith("s") && !last.endsWith("ss")) words[words.length - 1] = last.slice(0, -1);
  return words.join(" ");
}

/** True if this ingredient belongs on the spice-rack list instead of the grocery list. */
export function isSpice(name, unit = "", raw = "") {
  const text = `${name} ${raw}`.toLowerCase();
  unit = String(unit || "").toLowerCase().trim();
  if (PACKET.test(text) || PACKET_UNITS.has(unit)) return false; // gravy mix, a packet of taco seasoning: buy it
  if (!text.includes("bay") && /\b(fresh|sprigs?|bunch(es)?|leaves)\b/.test(text)) return false; // fresh herbs are produce
  const k = key(name);
  const stripped = k.replace(/^(ground|dried|whole|crushed|smoked|sweet|hot|mild)\s+/, "");
  if (SPICES.has(k) || (stripped !== k && SPICES.has(stripped))) return true;
  if (DRIED_BY_DEFAULT.has(stripped)) return /\b(dried|ground)\b/.test(text) || SMALL_UNITS.has(unit);
  return false;
}
