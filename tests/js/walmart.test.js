import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPlan, productOptions } from "../../extension/lib/plan.js";
import { pickCheapest, pickProduct } from "../../extension/lib/rank.js";
import { searchQuery } from "../../extension/lib/search.js";
import { STORE_BRANDS, parseSearchPage, searchUrl } from "../../extension/lib/walmart.js";
import { isBlockedUrl } from "../../extension/walmart_page.js";
import { fixture } from "./helpers.js";

const p = (id, name, price, available = true) => ({ id, name, url: `https://www.walmart.com/ip/${id}`, price, available, sponsored: false });

test("reads products from a Walmart search page", () => {
  const products = parseSearchPage(fixture("walmart_search.html"));
  assert.deepEqual(products.map((x) => x.id), ["111", "222", "333"]); // ad skipped, duplicate dropped
  assert.equal(products[1].url, "https://www.walmart.com/ip/Great-Value-Heavy-Whipping-Cream-32-fl-oz/222");
  assert.equal(products[1].price, 4.97);
  assert.ok(products[0].sponsored && !products[2].available);
  assert.equal(searchUrl("heavy whipping cream"), "https://www.walmart.com/search?q=heavy+whipping+cream");
});

test("best match prefers the plain store brand in stock", () => {
  const ranked = pickProduct(parseSearchPage(fixture("walmart_search.html")), "Heavy Cream", STORE_BRANDS);
  assert.equal(ranked[0].id, "222");
  assert.equal(ranked.at(-1).id, "333");
});

test("cheapest skips cheaper items that aren't a match", () => {
  const [ranked, nGood] = pickCheapest(parseSearchPage(fixture("walmart_search.html")), "heavy whipping cream", STORE_BRANDS);
  assert.equal(ranked[0].id, "222"); // not the $4.12 chocolate topping
  assert.equal(nGood, 1);
});

test("cheapest good match wins over the store brand", () => {
  const products = [
    p("1", "Great Value Yellow Onions, 3 lb Bag", 3.24),
    p("2", "Fresh Yellow Onion, Each", 0.98),
    p("3", "Fresh Red Onion, Each", 0.5),
    p("4", "Fresh Yellow Onions, 2 lb", null),
    p("5", "Sweet Yellow Onion, Each", 0.25, false),
  ];
  const [ranked, nGood] = pickCheapest(products, "yellow onion", STORE_BRANDS);
  assert.deepEqual(ranked.slice(0, nGood).map((x) => x.id), ["2", "1"]);
  assert.deepEqual(new Set(ranked.slice(nGood).map((x) => x.id)), new Set(["3", "4", "5"]));
});

test("cheapest counts how many packages you need", () => {
  const item = { key: "broth", name: "Chicken Broth", quantity: 8, unit: "cup", query: "chicken broth" };
  // 8 cups: two 32 oz at $2.50 ($5.00) beat four 16 oz at $1.75 ($7.00).
  const options = productOptions(item, [p("1", "Chicken Broth, 16 oz", 1.75), p("2", "Chicken Broth, 32 oz", 2.5)], { id: "1" });
  assert.deepEqual(options.map((o) => [o.id, o.qty, o.cheapest, o.usual]), [["2", 2, true, false], ["1", 4, false, true]]);
  // For 1 cup the small one is cheaper.
  const small = productOptions({ ...item, quantity: 1 }, [p("1", "Chicken Broth, 16 oz", 1.75), p("2", "Chicken Broth, 32 oz", 2.5)]);
  assert.equal(small[0].id, "1");
});

test("with no prices, the best match comes first", () => {
  const [ranked, nGood] = pickCheapest([p("1", "Flavored Broth Snack", null), p("2", "Great Value Chicken Broth", null)], "chicken broth", STORE_BRANDS);
  assert.equal(ranked[0].id, "2");
  assert.equal(nGood, 0);
});

test("recipe wording becomes store wording", () => {
  const cases = [
    ["Cut Up Fryer Chicken", "", "whole chicken cut up"],
    ["Fresh Jalapenos", "", "jalapeno peppers"],
    ["Whole Tomatoes", "can", "whole peeled tomatoes canned"],
    ["Heavy Cream", "cup", "heavy whipping cream"],
    ["Onion", "", "yellow onion"],
    ["Green Bell Peppers", "", "green bell pepper"],
    ["Fresh Oregano", "tablespoon", "fresh oregano"],
    ["Parmesan Cheese Shavings", "", "shaved parmesan cheese"],
    ["Ditalini Pasta (very Short Macaroni-type Pasta Noodles)", "box", "ditalini pasta"],
    ["Low Sodium Chicken Broth", "cup", "low sodium chicken broth"],
    ["garlic", "clove", "fresh garlic"],
    ["large eggs", "", "large eggs"],
    ["whole milk", "gallon", "whole milk"],
    ["boneless skinless chicken breasts", "pound", "boneless skinless chicken breast"],
    ["black beans", "can", "black beans canned"],
    ["butter", "tablespoon", "butter"],
    ["unsalted butter", "tablespoon", "unsalted butter"],
  ];
  for (const [name, unit, want] of cases) assert.equal(searchQuery(name, unit), want, name);
});

test("plan: shopping list, pantry line, spice list, your own searches", () => {
  const recipes = [{ title: "Tacos", lines: ["1 lb ground beef", "2 tsp chili powder", "1 tbsp olive oil", "Salt and pepper", "1 onion"] }];
  const plan = buildPlan(recipes, ["olive oil"], { onion: "white onion" });
  assert.deepEqual(plan.recipes, ["Tacos"]);
  assert.deepEqual(plan.items.map((i) => [i.name, i.amount, i.query]), [["ground beef", "1 lb", "ground beef"], ["onion", "1", "white onion"]]);
  assert.deepEqual(plan.pantrySkipped, ["olive oil"]);
  assert.deepEqual(plan.spices, [{ name: "chili powder", amount: "2 tsp" }]);
});

test("plan: your searches win, then suggested ones, then the rules", () => {
  const recipes = [{ title: "Soup", lines: ["1 onion", "1 whole Cut Up Fryer Chicken", "2 c. Heavy Cream"] }];
  const plan = buildPlan(recipes, [], { onion: "white onion" }, { onion: "sweet onion", "cut up fryer chicken": "whole fryer chicken cut up" });
  assert.deepEqual(plan.items.map((i) => [i.query, i.querySource]), [
    ["white onion", "you"],
    ["whole fryer chicken cut up", "suggested"],
    ["heavy whipping cream", "rules"],
  ]);
});

test("plan: a staple the task marks as pantry is left off, unless you set your own search", () => {
  const recipes = [{ title: "Muffins", lines: ["2 c. all-purpose flour", "1 tsp vanilla extract", "2 c. grated carrots"] }];
  const suggested = { "all purpose flour": "(pantry)", "vanilla extract": "(pantry)" };
  let plan = buildPlan(recipes, [], {}, suggested);
  assert.deepEqual(plan.items.map((i) => i.key), ["grated carrot"]);
  assert.deepEqual(plan.pantrySkipped, ["all-purpose flour", "vanilla extract"]);
  plan = buildPlan(recipes, [], { "vanilla extract": "pure vanilla extract" }, suggested);
  assert.deepEqual(plan.items.map((i) => i.query), ["pure vanilla extract", "grated carrots"]);
});

test("checkout is always blocked", () => {
  for (const url of ["https://www.walmart.com/checkout", "https://www.walmart.com/checkout/review-order?x=1",
    "https://www.walmart.com/payment", "https://www.walmart.com/place-order"]) assert.ok(isBlockedUrl(url), url);
  for (const url of ["https://www.walmart.com/cart", "https://www.walmart.com/ip/x/222", searchUrl("heavy cream")]) assert.ok(!isBlockedUrl(url), url);
});
