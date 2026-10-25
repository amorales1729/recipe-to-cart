import assert from "node:assert/strict";
import { test } from "node:test";

import { formatAmount, formatQuantity } from "../../extension/lib/display.js";
import { buildGroceryList, ingredientKey, isAlwaysExcluded } from "../../extension/lib/grocery.js";
import { parseLine, parseLines } from "../../extension/lib/ingredients.js";
import { fromPage } from "../../extension/lib/recipe.js";
import { isSpice } from "../../extension/lib/spices.js";
import { packagesNeeded, parseSize } from "../../extension/lib/units.js";
import { fixture, pageFromHtml } from "./helpers.js";

const recipe = (title, ...ings) => ({
  title,
  ingredients: ings.map(([name, quantity, unit]) => ({ raw: "", name, quantity, unit })),
});

test("package sizes in product names", () => {
  assert.deepEqual(parseSize("Great Value Heavy Whipping Cream, 32 fl oz"), [32, "fl oz"]);
  assert.deepEqual(parseSize("Great Value Chicken Broth, 32 oz Carton"), [32, "oz"]);
  assert.deepEqual(parseSize("Fresh Yellow Onions, 3 lb Bag"), [3, "lb"]);
  assert.deepEqual(parseSize("Great Value Large White Eggs, 12 Count"), [12, "ct"]);
  assert.equal(parseSize("Fresh Celery"), null);
});

test("how many packages to buy", () => {
  assert.equal(packagesNeeded(8, "cup", "Chicken Broth, 32 oz Carton", "chicken broth"), 2);
  assert.equal(packagesNeeded(2, "cup", "Heavy Whipping Cream, 32 fl oz", "heavy cream"), 1);
  assert.equal(packagesNeeded(2, "pound", "Ground Beef, 1 lb", "ground beef"), 2);
  assert.equal(packagesNeeded(8, "", "Eggs, 6 Count", "eggs"), 2);
  assert.equal(packagesNeeded(1, "", "Yellow Onions, 3 lb Bag", "onion"), 1);
  assert.equal(packagesNeeded(2, "can", "Whole Peeled Tomatoes", "tomatoes"), 2);
  assert.equal(packagesNeeded(null, "", "Parmesan, 5 oz", "parmesan"), 1);
  assert.equal(packagesNeeded(5, "cup", "All Purpose Flour, 2 lb", "flour"), 1); // ~627 g vs 907 g
});

test("ingredient keys", () => {
  assert.equal(ingredientKey("Green Bell Peppers"), ingredientKey("green bell pepper"));
  assert.equal(ingredientKey("Whole Tomatoes"), "whole tomato");
  assert.equal(ingredientKey("Cherries"), "cherry");
  assert.equal(ingredientKey("Swiss"), "swiss");
});

test("merging recipes", () => {
  const a = recipe("Soup", ["Chicken Broth", 4, "cup"], ["Onion", 1, ""], ["Salt", null, ""]);
  const b = recipe("Stew", ["chicken broth", 1, "quart"], ["onions", 2, ""], ["Carrots", 3, ""]);
  const items = Object.fromEntries(buildGroceryList([a, b]).map((i) => [i.key, i]));
  assert.equal(items["chicken broth"].unit, "cup");
  assert.ok(Math.abs(items["chicken broth"].quantity - 8) < 0.01);
  assert.deepEqual(items["chicken broth"].sources, ["Soup", "Stew"]);
  assert.equal(items.onion.quantity, 3);
  assert.equal(items.salt, undefined);
  assert.equal(items.carrot.skipReason, "");
});

test("salt and black pepper are never listed, other peppers are", () => {
  for (const n of ["Salt", "kosher salt", "Sea Salt", "Pepper", "black pepper", "Ground Black Pepper",
    "freshly ground black pepper", "cracked black pepper", "Freshly Ground Pepper"]) assert.ok(isAlwaysExcluded(n), n);
  for (const n of ["Green Bell Peppers", "red bell pepper", "Fresh Jalapenos", "cayenne pepper",
    "red pepper flakes", "poblano pepper", "white pepper", "Salted Butter", "seasoned salt"]) assert.ok(!isAlwaysExcluded(n), n);
  const r = recipe("Soup", ["Salt", null, ""], ["Pepper", null, ""], ["Green Bell Peppers", 2, ""]);
  assert.deepEqual(buildGroceryList([r]).map((i) => i.name), ["Green Bell Peppers"]);
});

test("spice rack vs groceries", () => {
  const cat = (line) => {
    const [i] = parseLine(line);
    return isSpice(i.name, i.unit, i.raw) ? "spice" : "grocery";
  };
  for (const line of [
    "1 tsp ground cumin", "2 tsp chili powder", "1/2 tsp smoked paprika", "1 tsp garlic powder",
    "1 tsp dried oregano", "1 tsp oregano", "2 bay leaves", "1/4 tsp red pepper flakes",
    "1/4 tsp cayenne pepper", "1 tbsp Italian seasoning", "2 tbsp taco seasoning",
    "1/2 tsp ground cinnamon", "pinch of nutmeg", "1 tsp dried thyme", "1/2 tsp ground ginger", "1 tsp cumin",
  ]) assert.equal(cat(line), "spice", line);
  for (const line of [
    "1 packet taco seasoning", "1 (1 oz) envelope taco seasoning", "1 packet brown gravy mix",
    "1 envelope onion soup mix", "4 tbsp. Minced Fresh Oregano", "1/4 cup chopped cilantro",
    "3 cloves garlic, minced", "1 tbsp grated fresh ginger", "2 sprigs fresh thyme",
    "2 whole Green Bell Peppers, Diced", "2 whole Fresh Jalapenos", "1 cup fresh basil leaves",
    "2 lbs beef chuck", "1 inch piece ginger, grated", "1 tbsp yellow mustard", "1 tbsp mustard",
  ]) assert.equal(cat(line), "grocery", line);
});

test("oils are pantry staples; the soup's shopping list", () => {
  const r = fromPage(pageFromHtml(fixture("italian_chicken_soup.html")));
  const items = buildGroceryList([{ title: r.title, ingredients: parseLines(r.lines) }]);
  const pantry = items.filter((i) => i.skipReason).map((i) => i.name);
  assert.deepEqual(new Set(pantry), new Set(["Olive Oil", "Extra Virgin Olive Oil"]));
  const toBuy = items.filter((i) => !i.skipReason && i.category === "grocery").map((i) => i.name);
  assert.deepEqual(toBuy, [
    "Ditalini Pasta", "Cut Up Fryer Chicken", "Low Sodium Chicken Broth", "Onion", "Green Bell Peppers",
    "Celery", "Fresh Jalapenos", "Whole Tomatoes", "Heavy Cream", "Fresh Oregano", "Parmesan Cheese Shavings",
  ]);
});

test("amounts read like a recipe", () => {
  assert.equal(formatQuantity(1 / 3), "1/3");
  assert.equal(formatQuantity(1.5), "1 1/2");
  assert.equal(formatQuantity(2), "2");
  assert.equal(formatQuantity(0.25), "1/4");
  assert.equal(formatQuantity(2.3), "2.3");
  const cases = [
    [1, "tablespoon", "1 tbsp"], [4, "tablespoon", "4 tbsp"], [0.5, "teaspoon", "1/2 tsp"],
    [1 / 3, "cup", "1/3 cup"], [8, "cup", "8 cups"], [28, "ounce", "28 oz"], [2, "pound", "2 lbs"],
    [1, "pound", "1 lb"], [16, "fluid ounce", "16 fl oz"], [2, "stalk", "2 stalks"], [1, "stalks", "1 stalk"],
    [2, "box", "2 boxes"], [1, "can", "1 can"], [2, "", "2"], [null, "cup", ""],
  ];
  for (const [q, u, want] of cases) assert.equal(formatAmount(q, u), want, `${q} ${u}`);
});
