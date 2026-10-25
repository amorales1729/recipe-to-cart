from recipe_to_cart.search import search_query


def test_recipe_wording_becomes_store_wording():
    cases = {
        ("Cut Up Fryer Chicken", ""): "whole chicken cut up",
        ("Fresh Jalapenos", ""): "jalapeno peppers",
        ("Whole Tomatoes", "can"): "whole peeled tomatoes canned",
        ("Heavy Cream", "cup"): "heavy whipping cream",
        ("Onion", ""): "yellow onion",
        ("Green Bell Peppers", ""): "green bell pepper",
        ("Fresh Oregano", "tablespoon"): "fresh oregano",  # herbs keep "fresh"
        ("Parmesan Cheese Shavings", ""): "shaved parmesan cheese",
        ("Ditalini Pasta (very Short Macaroni-type Pasta Noodles)", "box"): "ditalini pasta",
        ("Low Sodium Chicken Broth", "cup"): "low sodium chicken broth",
        ("garlic", "cloves"): "fresh garlic",
        ("large eggs", ""): "large eggs",
        ("whole milk", "gallon"): "whole milk",
        ("boneless skinless chicken breasts", "pound"): "boneless skinless chicken breast",
        ("black beans", "can"): "black beans canned",
    }
    for (name, unit), expected in cases.items():
        assert search_query(name, unit) == expected, name
