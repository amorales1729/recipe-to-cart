import assert from "node:assert/strict";
import { test } from "node:test";

import { parseLine, parseLines } from "../../extension/lib/ingredients.js";
import { RecipeError, fromHtml, fromPage, fromText } from "../../extension/lib/recipe.js";
import { fixture, pageFromHtml } from "./helpers.js";

const one = (line) => {
  const [i] = parseLine(line);
  return [i.name, i.quantity, i.unit];
};

test("reads the recipe from a page's schema.org data", () => {
  const r = fromPage(pageFromHtml(fixture("italian_chicken_soup.html")));
  assert.equal(r.title, "Italian Chicken Soup");
  assert.equal(r.lines.length, 14);
  assert.ok(r.instructions.length >= 3);
  const names = parseLines(r.lines).map((i) => i.name);
  assert.ok(names.includes("Ditalini Pasta"));
  assert.ok(names.includes("Onion")); // "whole Medium Onion" cleaned up
  assert.ok(names.includes("Salt") && names.includes("Freshly Ground Pepper")); // split in two
  assert.ok(names.includes("Whole Tomatoes")); // "whole" kept when there's a unit
  assert.deepEqual(one("2 c. Heavy Cream"), ["Heavy Cream", 2, "cup"]);
});

test("reads a recipe from fetched HTML", () => {
  const r = fromHtml(fixture("italian_chicken_soup.html"), "https://example.com/soup");
  assert.equal(r.title, "Italian Chicken Soup");
  assert.equal(r.url, "https://example.com/soup");
  assert.equal(r.lines.length, 14);
  assert.throws(() => fromHtml("<html><title>Nope</title></html>"), RecipeError);
});

test("falls back to text you selected on the page", () => {
  const page = { url: "https://x.test/r", jsonld: ["not json", '{"@type":"WebPage"}'], selection: "Toast\nIngredients\n2 slices bread\n1 tbsp butter" };
  const r = fromPage(page);
  assert.equal(r.title, "Toast");
  assert.deepEqual(r.lines, ["2 slices bread", "1 tbsp butter"]);
  assert.throws(() => fromPage({ ...page, selection: "" }), RecipeError);
});

test("ingredient lines", () => {
  const cases = {
    "1 box Ditalini Pasta (very Short Macaroni-type Pasta Noodles)": ["Ditalini Pasta", 1, "box"],
    "1 whole Cut Up Fryer Chicken": ["Cut Up Fryer Chicken", 1, ""],
    "8 c. Low Sodium Chicken Broth": ["Low Sodium Chicken Broth", 8, "cup"],
    "2 stalks Celery, Diced": ["Celery", 2, "stalk"],
    "1 can (28-ounce) Can Whole Tomatoes": ["Whole Tomatoes", 1, "can"],
    "4 tbsp. Minced Fresh Oregano": ["Fresh Oregano", 4, "tablespoon"],
    "2 lbs beef chuck, cut into 1-inch cubes": ["beef chuck", 2, "pound"],
    "1 can (14.5 oz) diced tomatoes": ["diced tomatoes", 1, "can"],
    "2 (15 ounce) cans black beans, drained and rinsed": ["black beans", 2, "can"],
    "12 oz. bag frozen peas": ["frozen peas", 12, "ounce"],
    "1 (1 oz) envelope taco seasoning": ["taco seasoning", 1, "envelope"],
    "pinch of nutmeg": ["nutmeg", null, "pinch"],
    "1-1/2 cups flour": ["flour", 1.5, "cup"],
    "1½ cups sugar": ["sugar", 1.5, "cup"],
    "2-3 carrots": ["carrots", 3, ""], // ranges buy the upper amount
    "2 large eggs": ["eggs", 2, ""],
    "1 T butter": ["butter", 1, "tablespoon"],
    "1 t vanilla": ["vanilla", 1, "teaspoon"],
    "Juice of 1 lemon": ["lemon", 1, ""],
    "1/2 cup butter or margarine, softened": ["butter", 0.5, "cup"],
    "2 boneless, skinless chicken breasts": ["boneless skinless chicken breasts", 2, ""],
    "3 cloves garlic, minced": ["garlic", 3, "clove"],
    "1 cup shredded cheddar cheese": ["shredded cheddar cheese", 1, "cup"],
  };
  for (const [line, want] of Object.entries(cases)) assert.deepEqual(one(line), want, line);
  assert.ok(parseLine("Salt to taste")[0].toTaste);
  assert.equal(parseLine("Salt to taste")[0].name, "Salt");
  assert.deepEqual(parseLine("For the sauce:"), []);
  assert.deepEqual(parseLine("   "), []);
});

test("pasted text with headings", () => {
  const r = fromText(`Beef Stew

Ingredients:
- 2 lbs beef chuck, cut into 1-inch cubes
- 3 carrots, sliced
- 1 can (14.5 oz) diced tomatoes
- Salt to taste

Instructions
1. Brown the beef.
2. Add everything else and simmer 2 hours.
`);
  assert.equal(r.title, "Beef Stew");
  assert.equal(r.lines.length, 4);
  assert.deepEqual(one(r.lines[0]), ["beef chuck", 2, "pound"]);
  assert.deepEqual(r.instructions, ["Brown the beef.", "Add everything else and simmer 2 hours."]);
});

test("pasted text without headings", () => {
  const r = fromText(`Quick Pasta
1 lb spaghetti
2 cups marinara sauce
Boil the pasta until tender, then drain it well.
Toss with the warm sauce and serve right away.`);
  assert.deepEqual(parseLines(r.lines).map((i) => i.name), ["spaghetti", "marinara sauce"]);
  assert.equal(r.instructions.length, 2);
  assert.throws(() => fromText(""), RecipeError);
});

test("keeps the recipe's photo from its schema.org data, or the page's share image", () => {
  const ld = (image) => JSON.stringify({ "@type": "Recipe", name: "Soup", recipeIngredient: ["1 onion"], image });
  const page = (image, ogImage = "") => ({ url: "https://x.example/soup", title: "Soup", ogImage, jsonld: [ld(image)], selection: "" });
  assert.equal(fromPage(page("https://img.example/a.jpg")).image, "https://img.example/a.jpg");
  assert.equal(fromPage(page(["https://img.example/b.jpg", "https://img.example/c.jpg"])).image, "https://img.example/b.jpg");
  assert.equal(fromPage(page({ "@type": "ImageObject", url: "https://img.example/d.jpg" })).image, "https://img.example/d.jpg");
  assert.equal(fromPage(page(undefined, "https://img.example/og.jpg")).image, "https://img.example/og.jpg");
  assert.equal(fromPage(page("javascript:alert(1)")).image, "");
  const html = `<meta property="og:image" content="https://img.example/e.jpg"><script type="application/ld+json">${ld()}</script>`;
  assert.equal(fromHtml(html, "https://x.example/soup").image, "https://img.example/e.jpg");
});
