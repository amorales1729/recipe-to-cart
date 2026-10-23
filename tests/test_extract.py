from recipe_to_cart import extract


def test_from_html_reads_jsonld(fixture_text):
    r = extract.from_html(fixture_text("italian_chicken_soup.html"), "https://example.com/soup")
    assert r.title == "Italian Chicken Soup"
    names = [i.name for i in r.ingredients]
    assert "Ditalini Pasta" in names
    assert "Onion" in names  # "whole Medium Onion" cleaned up
    assert "Salt" in names and "Pepper" in names  # "Salt And Freshly Ground Pepper" split
    cream = next(i for i in r.ingredients if i.name == "Heavy Cream")
    assert (cream.quantity, cream.unit) == (2.0, "cup")
    assert len(r.instructions) >= 3


def test_jsonld_fallback_without_recipe_scrapers(fixture_text):
    data = extract.find_jsonld_recipe(fixture_text("italian_chicken_soup.html"))
    assert data["name"] == "Italian Chicken Soup"


def test_from_text_with_headings():
    text = """Beef Stew

Ingredients:
- 2 lbs beef chuck, cut into 1-inch cubes
- 3 carrots, sliced
- 1 can (14.5 oz) diced tomatoes
- Salt to taste

Instructions
1. Brown the beef.
2. Add everything else and simmer 2 hours.
"""
    r = extract.from_text(text)
    assert r.title == "Beef Stew"
    beef = r.ingredients[0]
    assert (beef.name, beef.quantity, beef.unit) == ("beef chuck", 2.0, "pound")
    assert r.ingredients[-1].to_taste
    assert r.instructions == ["Brown the beef.", "Add everything else and simmer 2 hours."]


def test_from_text_without_headings():
    text = """Quick Pasta
1 lb spaghetti
2 cups marinara sauce
Boil the pasta until tender, then drain it well.
Toss with the warm sauce and serve right away."""
    r = extract.from_text(text)
    assert [i.name for i in r.ingredients] == ["spaghetti", "marinara sauce"]
    assert len(r.instructions) == 2
