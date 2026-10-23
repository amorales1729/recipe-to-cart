"""Command line: rtc add / list / show / groceries / cart / pantry."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import extract
from .db import ProductChoice, Store, app_home
from .display import format_amount
from .grocery import build_grocery_list
from .models import GroceryItem, Recipe
from .stores.base import Product, pick_product
from .units import packages_needed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="rtc", description="Recipe to Grocery Cart")
    parser.add_argument("--db", help="database file (default: ~/.recipe-to-cart/recipes.db)")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("add", help="save a recipe from a URL, a text file, or pasted text")
    p.add_argument("url", nargs="?", help="recipe page URL")
    p.add_argument("--file", help="text file with the recipe (e.g. exported from Apple Notes)")
    p.add_argument("--paste", action="store_true", help="paste the recipe, then Ctrl+Z Enter (Windows) or Ctrl+D")
    p.add_argument("--title", help="override the recipe title")

    sub.add_parser("list", help="list saved recipes")

    p = sub.add_parser("show", help="show a saved recipe")
    p.add_argument("id", type=int)

    p = sub.add_parser("delete", help="delete a saved recipe")
    p.add_argument("id", type=int)

    p = sub.add_parser("groceries", help="merged grocery list for one or more recipes")
    p.add_argument("ids", type=int, nargs="+")

    p = sub.add_parser("cart", help="add the grocery list to your Walmart cart (never checks out)")
    p.add_argument("ids", type=int, nargs="+")
    p.add_argument("--browser", default="msedge", choices=["msedge", "chrome", "chromium"])
    p.add_argument("--yes", action="store_true", help="accept saved/top product picks without asking")

    p = sub.add_parser("pantry", help="items you already have, skipped when building a cart")
    p.add_argument("action", choices=["list", "add", "remove"])
    p.add_argument("names", nargs="*")

    args = parser.parse_args(argv)
    store = Store(args.db)
    try:
        return COMMANDS[args.cmd](store, args)
    except extract.ExtractionError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    finally:
        store.close()


def cmd_add(store: Store, args) -> int:
    if args.url:
        existing = store.find_by_url(args.url)
        if existing:
            print(f"Already saved as recipe #{existing}.")
            return 0
        recipe = extract.from_url(args.url)
    elif args.file:
        recipe = extract.from_text(Path(args.file).read_text(encoding="utf-8"), args.title)
    elif args.paste:
        print("Paste the recipe, then press Ctrl+Z and Enter (Windows) or Ctrl+D (Mac/Linux):")
        recipe = extract.from_text(sys.stdin.read(), args.title)
    else:
        print("Give a URL, --file, or --paste.", file=sys.stderr)
        return 2
    if args.title:
        recipe.title = args.title
    rid = store.save_recipe(recipe)
    print(f"Saved #{rid}: {recipe.title} ({len(recipe.ingredients)} ingredients, {len(recipe.instructions)} steps)")
    print_recipe(recipe)
    return 0


def cmd_list(store: Store, args) -> int:
    rows = store.list_recipes()
    if not rows:
        print("No recipes yet. Try: rtc add <url>")
    for rid, title, url in rows:
        print(f"#{rid:<4} {title}  {url}")
    return 0


def cmd_show(store: Store, args) -> int:
    recipe = store.get_recipe(args.id)
    if recipe is None:
        print(f"No recipe #{args.id}", file=sys.stderr)
        return 1
    print(f"#{recipe.id} {recipe.title}")
    if recipe.source_url:
        print(recipe.source_url)
    if recipe.yields:
        print(f"Makes: {recipe.yields}")
    print_recipe(recipe)
    return 0


def cmd_delete(store: Store, args) -> int:
    ok = store.delete_recipe(args.id)
    print("Deleted." if ok else f"No recipe #{args.id}")
    return 0 if ok else 1


def print_recipe(recipe: Recipe) -> None:
    print("\nIngredients:")
    for g in recipe.ingredients:
        amount = format_amount(g.quantity, g.unit)
        extra = f"  ({g.prep})" if g.prep else ""
        print(f"  - {amount:<14} {g.name}{extra}")
    print("\nInstructions:")
    for i, step in enumerate(recipe.instructions, 1):
        print(f"  {i}. {step}")


def _load(store: Store, ids: list[int]) -> list[Recipe] | None:
    recipes = []
    for rid in ids:
        r = store.get_recipe(rid)
        if r is None:
            print(f"No recipe #{rid}", file=sys.stderr)
            return None
        recipes.append(r)
    return recipes


def cmd_groceries(store: Store, args) -> int:
    recipes = _load(store, args.ids)
    if recipes is None:
        return 1
    items = build_grocery_list(recipes, store.pantry())
    print("Grocery list (goes to the cart):")
    for item in items:
        if item.category == "grocery":
            mark = "  (pantry, skipped)" if item.skip_reason else ""
            print(f"  [{' ' if item.skip_reason else 'x'}] {item.amount_text:<16} {item.name}{mark}")
    print_spice_list(items)
    return 0


def print_spice_list(items: list[GroceryItem]) -> None:
    spices = [i for i in items if i.category == "spice"]
    if spices:
        print("\nSpices & seasonings (check your spice rack; not added to the cart):")
        for item in spices:
            print(f"  [ ] {item.amount_text:<16} {item.name}")


def cmd_pantry(store: Store, args) -> int:
    if args.action == "add":
        for n in args.names:
            store.add_pantry(n)
    elif args.action == "remove":
        for n in args.names:
            if not store.remove_pantry(n):
                print(f"'{n}' wasn't in the pantry.")
    print("Pantry: " + (", ".join(store.pantry()) or "(empty)"))
    return 0


def cmd_cart(store: Store, args) -> int:
    from .stores.walmart import WalmartCart

    recipes = _load(store, args.ids)
    if recipes is None:
        return 1
    all_items = build_grocery_list(recipes, store.pantry())
    items = [i for i in all_items if i.category == "grocery" and not i.skip_reason]
    print_spice_list(all_items)
    print(f"{len(items)} items to add. A browser window will open. Nothing will be purchased.")

    plan: list[tuple[GroceryItem, Product, int]] = []
    with WalmartCart(app_home() / "browser-profile", browser=args.browser) as cart:
        cart.ensure_logged_in()

        # 1) Review: choose a product and package count for every item before touching the cart.
        for item in items:
            chosen = choose_product(store, cart, item, auto=args.yes)
            if chosen:
                plan.append(chosen)

        if not plan:
            print("Nothing to add.")
            return 0
        print("\nAbout to add to your Walmart cart:")
        for item, product, qty in plan:
            price = f"${product.price:.2f}" if product.price else ""
            print(f"  {qty} x {product.name} {price}   <- {item.amount_text} {item.name}")
        if not args.yes and input("\nAdd these to the cart? [Y/n] ").strip().lower() not in ("", "y", "yes"):
            print("Cancelled. Nothing was added.")
            return 0

        # 2) Fill the cart.
        for item, product, qty in plan:
            print(f"Adding {qty} x {product.name} ...")
            cart.add_to_cart(product, qty)
        cart.open_cart()
        input("\nDone. Your cart is open in the browser. Review it and check out yourself if you want. "
              "Press Enter to close the browser... ")
    return 0


def choose_product(store: Store, cart, item: GroceryItem, auto: bool) -> tuple[GroceryItem, Product, int] | None:
    saved = store.get_choice(cart.name, item.key)
    if saved:
        product = Product(id=saved.product_id, name=saved.product_name, url=saved.product_url)
        candidates = [product]
    else:
        candidates = pick_product(cart.search(item.name), item.name, cart.store_brands)
        if not candidates:
            print(f"\n{item.name}: no results found, skipping.")
            return None

    idx = 0
    while True:
        product = candidates[idx]
        qty = packages_needed(item.quantity, item.unit, product.name, item.name)
        if auto:
            break
        price = f"${product.price:.2f}" if product.price else ""
        tag = " (saved pick)" if saved and idx == 0 else ""
        print(f"\n{item.amount_text} {item.name}")
        print(f"  -> {qty} x {product.name} {price}{tag}")
        answer = input("  [Enter]=ok  n=next option  s=skip  r=re-search  <number>=quantity: ").strip().lower()
        if answer == "":
            break
        if answer == "s":
            return None
        if answer == "n":
            idx = (idx + 1) % len(candidates)
            continue
        if answer == "r":
            saved = None
            candidates = pick_product(cart.search(item.name), item.name, cart.store_brands) or candidates
            idx = 0
            continue
        if answer.isdigit() and int(answer) > 0:
            qty = int(answer)
            break

    store.save_choice(cart.name, item.key, ProductChoice(product.id, product.name, product.url))
    return item, product, qty


COMMANDS = {
    "add": cmd_add,
    "list": cmd_list,
    "show": cmd_show,
    "delete": cmd_delete,
    "groceries": cmd_groceries,
    "cart": cmd_cart,
    "pantry": cmd_pantry,
}


if __name__ == "__main__":
    sys.exit(main())
