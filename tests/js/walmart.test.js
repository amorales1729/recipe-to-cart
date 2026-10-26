import assert from "node:assert/strict";
import { test } from "node:test";

import { AISLES, aisleFor } from "../../extension/lib/aisles.js";
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
  assert.deepEqual(plan.items.map((i) => [i.name, i.amount, i.query]), [["ground beef", "1 lb", "ground beef"], ["onion", "1 (about 5 oz)", "white onion"]]);
  const brief = ({ name, amount, searchUrl }) => ({ name, amount, searchUrl });
  assert.deepEqual(plan.pantrySkipped.map(brief), [{ name: "olive oil", amount: "1 tbsp", searchUrl: searchUrl("olive oil") }]);
  assert.deepEqual(plan.spices.map(brief), [{ name: "chili powder", amount: "2 tsp", searchUrl: searchUrl("chili powder") }]);
  assert.deepEqual([plan.spices[0].quantity, plan.spices[0].unit, plan.spices[0].query], [2, "teaspoon", "chili powder"]);
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
  assert.deepEqual(plan.pantrySkipped.map((p) => p.name), ["all-purpose flour", "vanilla extract"]);
  assert.equal(plan.pantrySkipped[0].searchUrl, searchUrl("all-purpose flour")); // the rules' search, not "(pantry)"
  plan = buildPlan(recipes, [], { "vanilla extract": "pure vanilla extract" }, suggested);
  assert.deepEqual(plan.items.map((i) => i.query), ["pure vanilla extract", "grated carrots"]);
});

test("checkout is always blocked", () => {
  for (const url of ["https://www.walmart.com/checkout", "https://www.walmart.com/checkout/review-order?x=1",
    "https://www.walmart.com/payment", "https://www.walmart.com/place-order"]) assert.ok(isBlockedUrl(url), url);
  for (const url of ["https://www.walmart.com/cart", "https://www.walmart.com/ip/x/222", searchUrl("heavy cream")]) assert.ok(!isBlockedUrl(url), url);
});

test("product photos come along with search results", () => {
  const items = [
    { __typename: "Product", usItemId: "1", name: "Onion", price: 1, imageInfo: { thumbnailUrl: "https://i5.walmartimages.com/a.jpg" } },
    { __typename: "Product", usItemId: "2", name: "Leek", price: 1, image: "https://i5.walmartimages.com/b.jpg" },
    { __typename: "Product", usItemId: "3", name: "Kale", price: 1 },
  ];
  const html = `<script id="__NEXT_DATA__">${JSON.stringify({ props: { items } })}</script>`;
  assert.deepEqual(parseSearchPage(html).map((p) => p.image),
    ["https://i5.walmartimages.com/a.jpg", "https://i5.walmartimages.com/b.jpg", ""]);
});

test("aisles group the cart page like a walk through the store", () => {
  const cases = [
    ["Cut Up Fryer Chicken", "", "meat"], ["Low Sodium Chicken Broth", "cup", "pantry"], ["Whole Tomatoes", "can", "pantry"],
    ["Green Bell Peppers", "", "produce"], ["Heavy Cream", "cup", "dairy"], ["peanut butter", "tablespoon", "pantry"],
    ["eggs", "", "dairy"], ["flour tortillas", "", "bakery"], ["raisins", "cup", "baking"], ["frozen peas", "bag", "frozen"],
    ["Ditalini Pasta", "box", "pantry"], ["taco seasoning", "packet", "pantry"], ["paper towels", "", "other"],
  ];
  for (const [name, unit, want] of cases) assert.equal(aisleFor(name, unit), want, name);
  assert.ok(cases.every(([, , a]) => AISLES.some(([id]) => id === a)));
});

test("prices: a $0 on the search card isn't a price, and cents are cents", () => {
  const items = [
    { __typename: "Product", usItemId: "1", name: "Russet Potatoes, 5 lb", price: 0, priceInfo: { linePrice: "$3.47" } },
    { __typename: "Product", usItemId: "2", name: "Banana, Each", price: 0, priceInfo: { linePrice: "27¢" } },
    { __typename: "Product", usItemId: "3", name: "Mixed Peppers", price: 0, priceInfo: { priceRangeString: "Options from $1.50 – $3.00" } },
    { __typename: "Product", usItemId: "4", name: "Mystery Item", price: 0, priceInfo: {} },
    { __typename: "Product", usItemId: "5", name: "Celery", priceInfo: { currentPrice: { price: 1.98, priceString: "$1.98" } } },
  ];
  const html = `<script id="__NEXT_DATA__">${JSON.stringify({ props: { items } })}</script>`;
  assert.deepEqual(parseSearchPage(html).map((x) => x.price), [3.47, 0.27, 1.5, null, 1.98]);
});

test("picks: 5 potatoes is about 2.3 lb, so the cheapest bag that covers it, never frozen or canned", () => {
  const [item] = buildPlan([{ title: "Stew", lines: ["5 potatoes"] }], []).items;
  assert.equal(item.amount, "5 (about 2.3 lb)");
  const products = [
    p("1", "Ore-Ida Golden Crinkles French Fried Potatoes, 32 oz", 1.98),
    p("2", "Great Value Frozen Diced Potatoes, 32 oz", 2.12),
    p("3", "Great Value Whole White Potatoes, 15 oz Can", 0.78),
    p("4", "Fresh Russet Potatoes, 5 lb Bag", 3.47),
    p("5", "Fresh Russet Potatoes, 3 lb Bag", 2.97),
    p("6", "Fresh Russet Potato, Each", 0.88),
    p("7", "Fresh Russet Potatoes, 1 lb Bag", 1.24),
    p("8", "Potatoes, Unpriced Bundle", null),
  ];
  const options = productOptions(item, products);
  assert.deepEqual(options.slice(0, 4).map((o) => [o.id, o.qty]), [["5", 1], ["4", 1], ["7", 3], ["6", 5]]);
  assert.ok(options[0].cheapest);
  assert.ok(!options.some((o) => ["1", "2", "3"].includes(o.id) && o.cheapest));
  assert.ok(!options.some((o) => o.id === "8"), "no unpriced products when others have prices");
});

test("picks: frozen when the recipe asks for frozen", () => {
  const [item] = buildPlan([{ title: "Soup", lines: ["1 bag frozen peas"] }], []).items;
  const options = productOptions({ ...item, query: "sweet peas" }, [
    p("1", "Del Monte Sweet Peas, 15 oz Can", 0.98),
    p("2", "Great Value Frozen Sweet Peas, 12 oz", 1.12),
  ]);
  assert.equal(options[0].id, "2");
});
