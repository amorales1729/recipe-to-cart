from recipe_to_cart.display import format_amount, format_quantity


def test_format_quantity():
    assert format_quantity(1 / 3) == "1/3"
    assert format_quantity(1.5) == "1 1/2"
    assert format_quantity(2.0) == "2"
    assert format_quantity(0.25) == "1/4"
    assert format_quantity(2.3) == "2.3"  # not close to a common fraction


def test_format_amount_uses_common_abbreviations():
    assert format_amount(1, "tablespoon") == "1 tbsp"
    assert format_amount(4, "tablespoon") == "4 tbsp"
    assert format_amount(0.5, "teaspoon") == "1/2 tsp"
    assert format_amount(1 / 3, "cup") == "1/3 cup"
    assert format_amount(8, "cup") == "8 cups"
    assert format_amount(28, "ounce") == "28 oz"
    assert format_amount(2, "pound") == "2 lbs"
    assert format_amount(1, "pound") == "1 lb"
    assert format_amount(16, "fluid_ounce") == "16 fl oz"
    assert format_amount(2, "stalks") == "2 stalks"
    assert format_amount(1, "stalks") == "1 stalk"
    assert format_amount(2, "box") == "2 boxes"
    assert format_amount(1, "can") == "1 can"
    assert format_amount(2, "") == "2"
    assert format_amount(None, "cup") == ""
