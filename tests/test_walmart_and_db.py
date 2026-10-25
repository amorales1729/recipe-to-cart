from recipe_to_cart.db import ProductChoice, Store
from recipe_to_cart.models import Ingredient, Recipe
from recipe_to_cart.stores.base import Product, is_blocked_url, pick_cheapest, pick_product
from recipe_to_cart.stores.walmart import STORE_BRANDS, parse_search_html, search_url


def test_parse_search_html(fixture_text):
    products = parse_search_html(fixture_text("walmart_search.html"))
    assert [p.id for p in products] == ["111", "222", "333"]  # ad skipped, duplicate dropped
    gv = products[1]
    assert gv.url == "https://www.walmart.com/ip/Great-Value-Heavy-Whipping-Cream-32-fl-oz/222"
    assert gv.price == 4.97
    assert products[0].sponsored and not products[2].available


def test_pick_prefers_plain_store_brand_in_stock(fixture_text):
    products = parse_search_html(fixture_text("walmart_search.html"))
    ranked = pick_product(products, "Heavy Cream", STORE_BRANDS)
    assert ranked[0].id == "222"
    assert ranked[-1].id == "333"  # out of stock last


def test_cheapest_skips_cheaper_items_that_are_not_a_match(fixture_text):
    products = parse_search_html(fixture_text("walmart_search.html"))
    ranked, n_good = pick_cheapest(products, "heavy whipping cream", STORE_BRANDS)
    # The $4.12 chocolate topping is cheaper but isn't heavy cream; the organic one is out of stock.
    assert ranked[0].id == "222" and n_good == 1


def _p(pid, name, price, available=True):
    return Product(id=pid, name=name, url=f"https://www.walmart.com/ip/{pid}", price=price, available=available)


def test_cheapest_good_match_wins_over_store_brand():
    products = [
        _p("1", "Great Value Yellow Onions, 3 lb Bag", 3.24),
        _p("2", "Fresh Yellow Onion, Each", 0.98),
        _p("3", "Fresh Red Onion, Each", 0.50),  # cheaper, wrong onion
        _p("4", "Fresh Yellow Onions, 2 lb", None),  # no price shown
        _p("5", "Sweet Yellow Onion, Each", 0.25, available=False),
    ]
    ranked, n_good = pick_cheapest(products, "yellow onion", STORE_BRANDS)
    assert [p.id for p in ranked[:n_good]] == ["2", "1"]
    assert {p.id for p in ranked[n_good:]} == {"3", "4", "5"}


def test_cheapest_counts_how_many_packages_you_need():
    small, big = _p("1", "Broth, 32 oz", 2.00), _p("2", "Broth, 64 oz", 3.50)
    # Needing two small cartons ($4.00) makes the big one ($3.50) the cheaper buy.
    cost = {"1": 4.00, "2": 3.50}
    ranked, _ = pick_cheapest([small, big], "broth", cost=lambda p: cost[p.id])
    assert ranked[0].id == "2"
    ranked, _ = pick_cheapest([small, big], "broth")
    assert ranked[0].id == "1"


def test_no_prices_falls_back_to_best_match():
    products = [_p("1", "Flavored Broth Snack", None), _p("2", "Great Value Chicken Broth", None)]
    ranked, n_good = pick_cheapest(products, "chicken broth", STORE_BRANDS)
    assert ranked[0].id == "2" and n_good == 0


def test_checkout_is_always_blocked():
    for url in [
        "https://www.walmart.com/checkout",
        "https://www.walmart.com/checkout/review-order?x=1",
        "https://www.walmart.com/payment",
        "https://www.walmart.com/place-order",
    ]:
        assert is_blocked_url(url), url
    for url in ["https://www.walmart.com/cart", "https://www.walmart.com/ip/x/222", search_url("heavy cream")]:
        assert not is_blocked_url(url), url


def test_store_roundtrip(tmp_path):
    s = Store(tmp_path / "t.db")
    r = Recipe(
        title="Soup",
        ingredients=[Ingredient(raw="2 c. cream", name="cream", quantity=2, unit="cup", prep="")],
        instructions=["Step one.\nStill step one.", "Step two."],
        source_url="https://example.com/soup",
    )
    rid = s.save_recipe(r)
    back = s.get_recipe(rid)
    assert back.title == "Soup" and back.instructions == r.instructions
    assert back.ingredients[0].quantity == 2
    assert s.find_by_url("https://example.com/soup") == rid

    s.save_choice("walmart", "cream", ProductChoice("222", "GV Cream 32 fl oz", "https://x/222"))
    assert s.get_choice("walmart", "cream").product_id == "222"

    assert "water" in s.pantry()
    s.remove_pantry("water")
    s.close()
    s2 = Store(tmp_path / "t.db")  # removing a default pantry item sticks after reopening
    assert "water" not in s2.pantry()
    assert s2.delete_recipe(rid) and s2.get_recipe(rid) is None


def test_existing_database_gets_new_pantry_staples_once(tmp_path):
    import sqlite3

    path = tmp_path / "old.db"
    s = Store(path)
    s.close()
    # Pretend this database predates the oil staples.
    conn = sqlite3.connect(path)
    conn.execute("DELETE FROM pantry WHERE key != 'water' AND key != 'ice'")
    conn.execute("PRAGMA user_version = 1")
    conn.commit()
    conn.close()

    s = Store(path)
    assert "olive oil" in s.pantry() and "vegetable oil" in s.pantry()
    s.remove_pantry("olive oil")
    s.close()
    assert "olive oil" not in Store(path).pantry()  # stays removed
