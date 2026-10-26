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
   **Change search** and type a better search; it's remembered for that ingredient.
4. Click **Add to Walmart cart.** It adds each item and opens your Walmart cart. Check out yourself
   whenever you're ready. **Stop** pauses a search or an add; **Pick up where I left off** carries
   on, and **Start over** searches everything again. The list stays put if you switch tabs.

To shop for several recipes at once, open the **Recipes** tab (or click the button on any
non-recipe page), tick the ones you want, and click **Shop for N recipes**. The gear at the top
right opens **Settings** for the iPhone inbox.

## Send recipes from your iPhone

Share a recipe link from your iPhone with a **Send to Recipe to Cart** shortcut. It waits in a free
inbox in your own Google account (a Google Sheet with a small Apps Script) until Chrome is open on
your PC. The extension checks when Chrome starts and every 5 minutes, then either shows a number on
its button for you to review (the default) or fills your Walmart cart right away, if you choose.
Still free, still never checks out. One-time setup: [docs/iphone-shortcut.md](docs/iphone-shortcut.md).

The same Sheet has a **Search words** tab. New ingredients land there with the search the rules
came up with, and a scheduled task suggests better Walmart wording that the extension picks up.

## What goes on the list

- **Salt and black pepper** are never listed. Fresh peppers (bell, jalapeno) are groceries.
- **Pantry staples** (cooking oils, cooking spray, water, flour, sugar and the like) are left off.
  The search-words task decides which ingredients count. They're still listed at the bottom of
  your shopping list with an **Add to cart** button in case you're running low.
- **Spices and seasonings** from the spice rack (ground cumin, paprika, dried oregano, red pepper
  flakes, Italian seasoning) aren't added to the cart either. They're in the same list at the
  bottom, to check against your rack. Packets and mixes (taco seasoning packet, gravy mix, onion soup mix) and fresh herbs are
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

`apps-script/Code.gs` is the iPhone inbox; its tests run it against a fake Google Sheet.

The browser test loads the extension against fake recipe and Walmart sites and checks that the
cheapest match is picked, quantities are right, the cart is opened, and checkout is never touched.
