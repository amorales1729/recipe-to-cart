from recipe_to_cart.grocery import build_grocery_list, ingredient_key, is_always_excluded
from recipe_to_cart.models import Ingredient, Recipe
from recipe_to_cart.units import packages_needed, parse_size


def test_parse_size():
    assert parse_size("Great Value Heavy Whipping Cream, 32 fl oz") == (32.0, "fl oz")
    assert parse_size("Great Value Chicken Broth, 32 oz Carton") == (32.0, "oz")
    assert parse_size("Fresh Yellow Onions, 3 lb Bag") == (3.0, "lb")
    assert parse_size("Great Value Large White Eggs, 12 Count") == (12.0, "ct")
    assert parse_size("Fresh Celery") is None


def test_packages_needed():
    # 8 cups broth = 64 fl oz -> two 32 oz cartons (water-like density)
    assert packages_needed(8, "cup", "Chicken Broth, 32 oz Carton", "chicken broth") == 2
    # 2 cups cream = 16 fl oz -> one 32 fl oz carton
    assert packages_needed(2, "cup", "Heavy Whipping Cream, 32 fl oz", "heavy cream") == 1
    # 2 lb beef, sold in 1 lb packs -> 2
    assert packages_needed(2, "pound", "Ground Beef, 1 lb", "ground beef") == 2
    # 8 eggs, 6 ct packs -> 2
    assert packages_needed(8, "", "Eggs, 6 Count", "eggs") == 2
    # one onion vs a 3 lb bag -> 1 bag
    assert packages_needed(1, "", "Yellow Onions, 3 lb Bag", "onion") == 1
    # 2 cans with unknown size -> 2
    assert packages_needed(2, "can", "Whole Peeled Tomatoes", "tomatoes") == 2
    # no amount -> 1
    assert packages_needed(None, "", "Parmesan, 5 oz", "parmesan") == 1
    # 5 cups flour (~627 g) vs a 2 lb (907 g) bag -> 1
    assert packages_needed(5, "cup", "All Purpose Flour, 2 lb", "flour") == 1


def test_ingredient_key():
    assert ingredient_key("Green Bell Peppers") == ingredient_key("green bell pepper")
    assert ingredient_key("Whole Tomatoes") == "whole tomato"
    assert ingredient_key("Cherries") == "cherry"
    assert ingredient_key("Swiss") == "swiss"


def _recipe(title, *ings):
    return Recipe(title=title, ingredients=[Ingredient(raw="", name=n, quantity=q, unit=u) for n, q, u in ings], instructions=[])


def test_grocery_merge_and_pantry():
    a = _recipe("Soup", ("Chicken Broth", 4, "cup"), ("Onion", 1, ""), ("Salt", None, ""))
    b = _recipe("Stew", ("chicken broth", 1, "quart"), ("onions", 2, ""), ("Carrots", 3, ""))
    items = {i.key: i for i in build_grocery_list([a, b])}
    broth = items["chicken broth"]
    assert broth.unit == "cup" and abs(broth.quantity - 8) < 0.01
    assert broth.sources == ["Soup", "Stew"]
    assert items["onion"].quantity == 3
    assert "salt" not in items  # never listed at all
    assert items["carrot"].skip_reason == ""


def test_salt_and_black_pepper_never_listed_but_other_peppers_are():
    for name in ["Salt", "kosher salt", "Sea Salt", "Pepper", "black pepper", "Ground Black Pepper",
                 "freshly ground black pepper", "cracked black pepper"]:
        assert is_always_excluded(name), name
    for name in ["Green Bell Peppers", "red bell pepper", "Fresh Jalapenos", "cayenne pepper",
                 "red pepper flakes", "poblano pepper", "white pepper", "Salted Butter", "seasoned salt"]:
        assert not is_always_excluded(name), name
    r = _recipe("Soup", ("Salt", None, ""), ("Pepper", None, ""), ("Green Bell Peppers", 2, ""))
    assert [i.name for i in build_grocery_list([r])] == ["Green Bell Peppers"]


def _cat(raw):
    from recipe_to_cart.ingredients import parse_line
    from recipe_to_cart.spices import is_spice
    ing = parse_line(raw)[0]
    return "spice" if is_spice(ing.name, ing.unit, ing.raw) else "grocery"


def test_spice_rack_vs_groceries():
    spices = [
        "1 tsp ground cumin", "2 tsp chili powder", "1/2 tsp smoked paprika", "1 tsp garlic powder",
        "1 tsp dried oregano", "1 tsp oregano", "2 bay leaves", "1/4 tsp red pepper flakes",
        "1/4 tsp cayenne pepper", "1 tbsp Italian seasoning", "2 tbsp taco seasoning",
        "1/2 tsp ground cinnamon", "pinch of nutmeg", "1 tsp dried thyme",
    ]
    groceries = [
        "1 packet taco seasoning", "1 (1 oz) envelope taco seasoning", "1 packet brown gravy mix",
        "1 envelope onion soup mix", "4 tbsp. Minced Fresh Oregano", "1/4 cup chopped cilantro",
        "3 cloves garlic, minced", "1 tbsp grated fresh ginger", "2 sprigs fresh thyme",
        "2 whole Green Bell Peppers, Diced", "2 whole Fresh Jalapenos", "1 cup fresh basil leaves",
        "2 lbs beef chuck",
    ]
    for raw in spices:
        assert _cat(raw) == "spice", raw
    for raw in groceries:
        assert _cat(raw) == "grocery", raw


def test_spices_kept_off_cart_list():
    r = Recipe(title="Chili", instructions=[], ingredients=[
        Ingredient(raw="2 tsp chili powder", name="chili powder", quantity=2, unit="teaspoon"),
        Ingredient(raw="1 packet chili seasoning mix", name="chili seasoning mix", quantity=1, unit="packet"),
        Ingredient(raw="1 lb ground beef", name="ground beef", quantity=1, unit="pound"),
    ])
    cats = {i.name: i.category for i in build_grocery_list([r])}
    assert cats == {"chili powder": "spice", "chili seasoning mix": "grocery", "ground beef": "grocery"}
