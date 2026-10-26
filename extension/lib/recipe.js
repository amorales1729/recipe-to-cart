// Get a recipe out of a web page's schema.org data, or out of pasted text.
// A recipe is stored as {title, url, image, yields, lines: [ingredient lines], instructions: [steps]}.
// Lines are parsed when a list is built, so parser fixes apply to recipes saved earlier.

export class RecipeError extends Error {}

/** Runs inside the recipe page's tab. Must be self-contained: Chrome copies its source in. */
export function readRecipePage() {
  return {
    url: location.href,
    title: document.title,
    ogImage: (document.querySelector('meta[property="og:image"]') || {}).content || "",
    jsonld: Array.from(document.querySelectorAll('script[type="application/ld+json"]'), (s) => s.textContent),
    selection: String(window.getSelection ? window.getSelection() : ""),
  };
}

/** The first schema.org Recipe in a page's JSON-LD blocks, or null. */
export function findJsonLdRecipe(blocks) {
  for (const block of blocks) {
    let data;
    try {
      data = JSON.parse(block);
    } catch {
      continue;
    }
    const found = walkForRecipe(data);
    if (found) return found;
  }
  return null;
}

function walkForRecipe(obj) {
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = walkForRecipe(item);
      if (found) return found;
    }
  } else if (obj && typeof obj === "object") {
    const t = obj["@type"];
    if (t === "Recipe" || (Array.isArray(t) && t.includes("Recipe"))) return obj;
    for (const value of Object.values(obj)) {
      const found = walkForRecipe(value);
      if (found) return found;
    }
  }
  return null;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", frac12: "½", frac14: "¼", frac34: "¾", deg: "°" };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (all, code) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[code.toLowerCase()] ?? all;
  });
}

function text(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.length ? text(value[0]) : "";
  if (typeof value === "object") return text(value.text || value.name);
  return decodeEntities(String(value).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function instructions(value) {
  if (!value) return [];
  if (typeof value === "string") {
    return value.replace(/<[^>]+>/g, "\n").split(/\n+/).map((s) => text(s)).filter(Boolean);
  }
  const steps = [];
  for (const item of Array.isArray(value) ? value : [value]) {
    if (item && typeof item === "object" && item["@type"] === "HowToSection") steps.push(...instructions(item.itemListElement));
    else {
      const t = text(item);
      if (t) steps.push(t);
    }
  }
  return steps;
}

// The recipe's photo: schema.org allows a URL, a list of them, or ImageObjects.
function imageUrl(value) {
  if (Array.isArray(value)) return value.map(imageUrl).find(Boolean) || "";
  if (value && typeof value === "object") return imageUrl(value.url || value.contentUrl);
  const url = typeof value === "string" ? decodeEntities(value.trim()) : "";
  return /^https:\/\//i.test(url) ? url : "";
}

/** A recipe from a page read by readRecipePage(). Falls back to the text you selected on the page. */
export function fromPage(page) {
  const data = findJsonLdRecipe(page.jsonld || []);
  if (data && (data.recipeIngredient || data.ingredients)) {
    const lines = [].concat(data.recipeIngredient || data.ingredients).map(text).filter(Boolean);
    if (lines.length) {
      return {
        title: text(data.name) || page.title || "Untitled recipe",
        url: page.url || "",
        image: imageUrl(data.image) || imageUrl(page.ogImage),
        yields: text(data.recipeYield),
        lines,
        instructions: instructions(data.recipeInstructions),
      };
    }
  }
  if (page.selection && page.selection.trim()) {
    return { ...fromText(page.selection, null), url: page.url || "", image: imageUrl(page.ogImage) };
  }
  throw new RecipeError(
    "No recipe found on this page. Select the recipe text on the page and click the button again, or paste it on the Recipes page.",
  );
}

/** A recipe from a page's HTML fetched without opening it (for example a URL saved from a phone). */
export function fromHtml(html, url = "") {
  const jsonld = [...String(html).matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const title = (String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "";
  const ogImage = (String(html).match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)/i) || [])[1] || "";
  return fromPage({ url, title: text(title), ogImage, jsonld, selection: "" });
}

// ---- pasted text (Apple Notes, copied web pages) ----

const ING_HEADER = /^\s*ingredients?\s*:?\s*$/i;
const STEP_HEADER = /^\s*(instructions|directions|method|steps|preparation)\s*:?\s*$/i;
const BULLET = /^\s*([-*•▪●▢□☐]|\d+[.)])\s+/;
const STEP_PREFIX = /^\s*(step\s*\d+\s*[:.)-]?|\d+[.)])\s*/i;
const NUMBERED_STEP = /^\s*(step\s*\d+|\d+[.)])\s/i;
const STARTS_WITH_AMOUNT = /^\s*([-*•]\s*)?(\d|[¼-¾⅐-⅞]|a\s|an\s|one\s|two\s)/i;

export function fromText(raw, title = null) {
  const lines = String(raw || "").split(/\r?\n/).map((l) => l.replace(/\s+$/, ""));
  const nonblank = lines.filter((l) => l.trim());
  if (!nonblank.length) throw new RecipeError("The pasted text is empty.");

  const ingIdx = lines.findIndex((l) => ING_HEADER.test(l));
  const stepIdx = lines.findIndex((l) => STEP_HEADER.test(l));
  let ingLines, stepLines, header;
  if (ingIdx >= 0) {
    const end = stepIdx > ingIdx ? stepIdx : lines.length;
    ingLines = lines.slice(ingIdx + 1, end).filter((l) => l.trim()).map((l) => l.replace(BULLET, "").trim());
    stepLines = stepIdx >= 0 ? lines.slice(stepIdx + 1) : [];
    header = lines.slice(0, ingIdx);
  } else {
    // No headings: lines that start with an amount are ingredients, longer prose is steps.
    ingLines = [];
    stepLines = [];
    for (const l of nonblank.slice(1)) {
      if (STARTS_WITH_AMOUNT.test(l) && l.length < 90 && !NUMBERED_STEP.test(l)) ingLines.push(l.replace(BULLET, "").trim());
      else stepLines.push(l);
    }
    header = nonblank.slice(0, 1);
  }
  const steps = stepLines.filter((l) => l.trim()).map((l) => l.replace(STEP_PREFIX, "").trim());
  if (!title) title = (header.find((l) => l.trim()) || nonblank[0]).trim();
  if (!ingLines.length) {
    throw new RecipeError("Couldn't find an ingredient list. Put the ingredients under a line that says \"Ingredients\".");
  }
  return { title, url: "", yields: "", lines: ingLines, instructions: steps };
}
