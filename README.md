# Recipe to Cart

Give it a recipe (a URL or pasted text). It saves the ingredients and instructions, builds a grocery
list, picks Walmart products and package counts, and adds them to your Walmart cart.

**It never buys anything.** The browser it drives refuses to open any checkout or payment page.
You review the cart and check out yourself, if you want to.

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

3. That's it. The cart step uses Microsoft Edge, which Windows already has, so there is no browser
   to download. (Prefer Chrome? Add `--browser chrome`.)

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

### What `rtc cart` does

1. Opens an Edge window with its own profile. **The first time, sign in to Walmart in that window**
   and set your store. It stays signed in after that. This code never sees or stores your password.
2. For each grocery item it searches Walmart, picks a product (your saved pick if you've chosen one
   before; otherwise store brand, plain, in stock), and works out how many packages you need
   (8 cups of broth -> two 32 oz cartons).
3. Shows you each pick. Press Enter to accept, `n` for the next option, `s` to skip, `r` to search
   again, or type a number to set the quantity. Your choices are remembered for next time.
4. Shows the full list and asks before adding anything.
5. Adds everything at a human pace, then opens your cart for you to review.

If Walmart shows a "Robot or human?" check, solve it in the window and press Enter. If Walmart
changes its page and a button can't be found, the tool asks you to do that one step by hand
instead of guessing.

## Where your data lives

`%USERPROFILE%\.recipe-to-cart\`

- `recipes.db`: a SQLite database (a single file) with your recipes, product picks, and pantry.
  Copy it to back up.
- `browser-profile\`: the Edge profile used for Walmart, so you stay signed in.

## Project layout

```
src/recipe_to_cart/
  extract.py      recipe from URL (schema.org data via recipe-scrapers) or pasted text
  ingredients.py  "2 lbs beef chuck, cubed" -> quantity / unit / name / prep
  grocery.py      merge recipes into one list, skip pantry items
  units.py        unit conversion and package math
  db.py           SQLite storage
  stores/
    base.py       product picking rules and the checkout blocker
    walmart.py    Walmart search parsing and the cart-filling browser script
  cli.py          the `rtc` command
tests/            pytest suite (no network needed)
```

## Development

```powershell
pip install -e ".[dev]"
pytest
```

## Notes and limits

- Automating a store's website is for your personal use only. Store terms generally don't allow
  bots, so keep it slow and don't share it as a service.
- Walmart changes its site from time to time. Search results are read from the data Walmart embeds
  in the page, which is fairly stable. The Add to cart and + buttons are found by their labels,
  and if that breaks, the tool falls back to asking you.
