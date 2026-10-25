# Recipe to Cart

Give it a recipe (a URL or pasted text). It saves the ingredients and instructions, builds a grocery
list, picks Walmart products and package counts, and adds them to your Walmart cart.

**It never buys anything.** The Chrome extension only adds to your cart and refuses to open any
checkout or payment page. You review the cart and check out yourself, if you want to.

**It costs nothing to run.** No paid APIs, no AI calls, no cloud server. Everything runs on your PC
with free open-source libraries, and your data stays in one local file.

## Setup (Windows)

1. Install Python 3.11 or newer from [python.org](https://www.python.org/downloads/).
   On the first installer screen, tick **"Add python.exe to PATH"**.
2. Open PowerShell and run:

   ```powershell
   git clone https://github.com/amorales1729/recipe-to-cart.git
   cd recipe-to-cart
   py -m venv .venv
   .venv\Scripts\Activate.ps1
   pip install -e .
   ```

   If PowerShell says scripts are disabled, run
   `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, then activate again.

3. **Add the Chrome extension (once):**
   1. In Chrome, go to `chrome://extensions`.
   2. Turn on **Developer mode** (top right).
   3. Click **Load unpacked** and choose the `extension` folder inside `recipe-to-cart`.
   4. Click the puzzle-piece icon in the toolbar and pin **Recipe to Cart** so its button is always visible.

   The extension runs in your normal Chrome, where you're already signed in to Walmart. There's
   no separate login.

The first time you add a recipe, the ingredient parser downloads a small language model file (about
a few MB). That happens once.

Each time you open a new PowerShell window, `cd recipe-to-cart` and run `.venv\Scripts\Activate.ps1`
before using `rtc`.

## Use it

```powershell
# Save a recipe from a website
rtc add https://www.thepioneerwoman.com/food-cooking/recipes/a10331/italian-chicken-soup/

# Or paste one (from Apple Notes, a text, anywhere). Finish with Ctrl+Z then Enter.
rtc add --paste
# Or from a text file
rtc add --file stew.txt

rtc list                 # your saved recipes
rtc show 1               # ingredients and instructions
rtc groceries 1 2        # merged grocery list for recipes 1 and 2
rtc pantry add "olive oil" "garlic powder"   # things you already have; skipped in the cart

rtc cart 1 2             # fill your Walmart cart for recipes 1 and 2
```

Salt and black pepper are left off every list. Pantry staples (cooking oils, cooking spray, water)
are left off the shopping list too; see or change them with `rtc pantry list`, `rtc pantry add`,
and `rtc pantry remove`. Spice-rack items (ground cumin, paprika, dried
oregano, red pepper flakes, Italian seasoning...) go on a separate **Spices & seasonings** list to
check against your rack and are never added to the cart. Store-bought packets and mixes (taco
seasoning packet, gravy mix, onion soup mix) and fresh herbs are regular groceries.

### What `rtc cart` does

1. `rtc cart 1 2` builds the grocery list for those recipes, prints the spice-rack list, and waits.
2. In Chrome, click the **Recipe to Cart** button in the toolbar. A page opens with every item.
3. For each item it searches Walmart in a background tab, using your signed-in Chrome, and picks a
   product: your saved pick if you've chosen one before, otherwise store brand, plain and in stock.
   It also works out how many packages you need (8 cups of broth means two 32 oz cartons).
   Recipe wording is translated into store wording first ("cut up fryer chicken" is searched as
   "whole chicken cut up", "jalapenos" as "jalapeno peppers"; see `search.py`).
4. Check the list. Change any product with its dropdown, fix a quantity, or untick an item. If a
   search found the wrong kind of thing, click **change** under the item and type a better search.
   It's remembered for that ingredient from then on.
5. Click **Add to Walmart cart**. It adds each item at a human pace, then opens your cart.
   Your picks are saved, so next time they come up automatically.

If Walmart asks you to confirm you're human, the page tells you. Finish the check in the Walmart
tab and click continue. If an item can't be added (out of stock, or Walmart changed its page),
its row says so with a link to add it yourself.

## Where your data lives

`%USERPROFILE%\.recipe-to-cart\`

- `recipes.db`: a SQLite database (a single file) with your recipes, product picks, and pantry.
  Copy it to back up.
### Why an extension?

Chrome doesn't let outside programs control your everyday, signed-in browser (a security rule
since Chrome 136). Walmart also stalls logins in automated browser windows. An extension is the
one thing Chrome allows to work inside your normal browser, so it uses your existing Walmart
sign-in and browses like you do.

While `rtc cart` is running, the app listens on `127.0.0.1:8765`. That address is only reachable
from your own PC, and requests from websites are refused.

## Project layout

```
src/recipe_to_cart/
  extract.py      recipe from URL (schema.org data via recipe-scrapers) or pasted text
  ingredients.py  "2 lbs beef chuck, cubed" -> quantity / unit / name / prep
  grocery.py      merge recipes into one list, skip pantry items
  search.py       recipe wording -> what to type in the store's search box
  units.py        unit conversion and package math
  db.py           SQLite storage
  stores/
    base.py       product picking rules and the checkout blocker
    walmart.py    Walmart search-page parsing
  server.py       local helper the Chrome extension talks to during `rtc cart`
  cli.py          the `rtc` command
extension/        the Chrome extension (Manifest V3): review page, Walmart search, add to cart
tests/            pytest suite (no network needed)
```

## Development

```powershell
pip install -e ".[dev]"
pytest
```

`tests/test_extension_e2e.py` loads the extension into Chromium against a fake walmart.com. It's
skipped unless you set `RTC_E2E_CHROMIUM` to a Chromium executable path.

## Notes and limits

- Automating a store's website is for your personal use only. Store terms generally don't allow
  bots, so keep it slow and don't share it as a service.
- Walmart changes its site from time to time. Search results are read from the data Walmart embeds
  in the page, which is fairly stable. The Add to cart and + buttons are found by their labels,
  and if that breaks, the row says so and links to the product so you can add it yourself.
