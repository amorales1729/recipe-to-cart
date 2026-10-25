# Recipe to Cart

A Chrome extension that turns a recipe into a Walmart cart. Open a recipe page, click the
**Recipe to Cart** button, and it reads the ingredients, builds the shopping list, finds the
cheapest matching Walmart product for each item, and adds them to your cart when you say so.

**It never buys anything.** It only adds to your cart and refuses to open any checkout or payment
page. You review the cart and check out yourself.

**It costs nothing.** No paid APIs, no AI calls, no server, nothing to install besides the
extension. Everything runs inside your own Chrome, where you're already signed in to Walmart, and
your recipes are saved in Chrome on your computer.

## Install (once)

1. Download this repo: on GitHub click **Code → Download ZIP** and unzip it, or `git clone` it.
2. In Chrome, go to `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the `extension` folder inside `recipe-to-cart`.
5. Click the puzzle-piece icon in the toolbar and pin **Recipe to Cart** so its button is always visible.

To update later, get the new files (`git pull` or a fresh ZIP into the same folder), then click
the reload arrow on Recipe to Cart in `chrome://extensions`.

## Use it

1. **Open a recipe page** in Chrome and click the **Recipe to Cart** button. It saves the recipe and
   opens your list. Most recipe sites work, because they publish their recipes in a standard
   format. If one doesn't, select the recipe text on the page and click the button again.
2. **It searches Walmart** for each item in a background tab and picks the **cheapest good match for
   the amount you need**. A cheaper item that isn't the same thing (a flavored topping instead of
   heavy cream) never wins, and package math counts: 8 cups of broth is two 32 oz cartons, so a
   64 oz carton can be the better buy. Recipe wording is translated into store wording first ("cut
   up fryer chicken" is searched as "whole chicken cut up", "jalapenos" as "jalapeno peppers").
3. **Check the list.** Each item shows the product, price, and quantity. Change a product with its
   dropdown, fix a quantity, or untick an item. If a search found the wrong kind of thing, click
   **change** and type a better search; it's remembered for that ingredient. Click **I always have
   this** to add an item to your pantry staples.
4. Click **Add to Walmart cart.** It adds each item and opens your Walmart cart. Check out yourself
   whenever you're ready.

To shop for several recipes at once, click **Add more recipes** (or the button on any non-recipe
page) to open your saved recipes, tick the ones you want, and click **Shop for checked recipes**.
Recipes from Apple Notes or a text can be pasted there too.

## What goes on the list

- **Salt and black pepper** are never listed. Fresh peppers (bell, jalapeno) are groceries.
- **Pantry staples** (cooking oils, cooking spray, water, and anything you add) are left off. Edit
  them on the recipes page.
- **Spices and seasonings** from the spice rack (ground cumin, paprika, dried oregano, red pepper
  flakes, Italian seasoning) go on a separate list to check against your rack, and aren't added to
  the cart. Packets and mixes (taco seasoning packet, gravy mix, onion soup mix) and fresh herbs are
  regular groceries.
- Amounts from several recipes are combined (4 cups + 1 quart of broth = 8 cups).

## If something goes wrong

- **"Walmart wants to check you're human"**: finish the check in the Walmart tab, then click
  **I'm done, continue**.
- **An item says "No Add to cart button"**: it may be out of stock or need a pickup or delivery
  choice. Click **Open** next to it and add it by hand.

## For developers

The rules live in plain JavaScript modules under `extension/lib/` (ingredient parsing, grocery list,
spices, units and package math, Walmart wording, product ranking). Tests use Node's built-in test
runner, no packages to install:

```sh
npm test                              # unit tests (Node 20+)
RTC_E2E=1 npm run test:browser        # full extension run in Chromium (needs Playwright)
```

The browser test loads the extension against fake recipe and Walmart sites and checks that the
cheapest match is picked, quantities are right, the cart is opened, and checkout is never touched.
