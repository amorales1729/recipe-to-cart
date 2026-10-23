"""Unit conversion and "how many packages do I need" math."""
from __future__ import annotations

import math
import re

import pint

ureg = pint.UnitRegistry()

# Rough grams per milliliter, used only when a recipe gives volume and the store sells by weight.
DENSITY_G_PER_ML = {
    "flour": 0.53,
    "sugar": 0.85,
    "brown sugar": 0.9,
    "powdered sugar": 0.5,
    "butter": 0.96,
    "rice": 0.85,
    "oats": 0.38,
    "cheese": 0.45,
    "parmesan": 0.4,
    "honey": 1.42,
    "peanut butter": 1.08,
}
DEFAULT_DENSITY = 1.0  # water-like: broth, milk, cream, oil

# Recipe words that mean "one of the thing" rather than a measurable unit.
COUNT_UNITS = {
    "", "each", "whole", "piece", "pieces", "clove", "cloves", "stalk", "stalks", "head", "heads",
    "bunch", "bunches", "can", "cans", "box", "boxes", "package", "packages", "pkg", "jar", "jars",
    "bag", "bags", "bottle", "bottles", "sprig", "sprigs", "slice", "slices", "ct", "count",
}


def to_quantity(amount: float, unit: str) -> pint.Quantity | None:
    """A pint Quantity for measurable units, or None for counts like "2 stalks"."""
    unit = (unit or "").strip().lower()
    if unit in COUNT_UNITS:
        return None
    unit = {"fl oz": "fluid_ounce", "fl. oz": "fluid_ounce", "fl. oz.": "fluid_ounce", "c": "cup", "lbs": "pound"}.get(unit, unit)
    try:
        q = ureg.Quantity(amount, unit)
    except Exception:
        return None
    if q.check("[mass]") or q.check("[volume]"):
        return q
    return None


_SIZE = re.compile(
    r"(?P<n>\d+(?:\.\d+)?)\s*-?\s*(?P<u>fl\.?\s*oz\.?|fluid ounces?|oz\.?|ounces?|lbs?\.?|pounds?|"
    r"g|grams?|kg|ml|l|liters?|litres?|gal(?:lon)?s?|qt|quarts?|pt|pints?|ct|count|pk|pack)\b",
    re.I,
)


def parse_size(product_name: str) -> tuple[float, str] | None:
    """Find the package size in a product title, e.g. "Heavy Cream, 32 fl oz" -> (32, "fl oz")."""
    matches = list(_SIZE.finditer(product_name or ""))
    if not matches:
        return None
    m = matches[-1]  # sizes are usually at the end of the title
    unit = re.sub(r"\s+", " ", m.group("u").lower().rstrip(".")).replace("fl. oz", "fl oz")
    unit = {
        "ounce": "oz", "ounces": "oz", "fluid ounce": "fl oz", "fluid ounces": "fl oz",
        "lbs": "lb", "pound": "lb", "pounds": "lb", "gram": "g", "grams": "g",
        "liter": "l", "liters": "l", "litre": "l", "litres": "l",
        "gal": "gallon", "gals": "gallon", "gallons": "gallon",
        "quart": "qt", "quarts": "qt", "pint": "pt", "pints": "pt",
        "count": "ct", "pk": "ct", "pack": "ct",
    }.get(unit, unit)
    return float(m.group("n")), unit


def _size_quantity(n: float, unit: str) -> pint.Quantity | None:
    mapping = {"oz": "ounce", "fl oz": "fluid_ounce", "lb": "pound", "qt": "quart", "pt": "pint"}
    try:
        return ureg.Quantity(n, mapping.get(unit, unit))
    except Exception:
        return None


def density_for(name: str) -> float:
    lowered = name.lower()
    for key, d in DENSITY_G_PER_ML.items():
        if key in lowered:
            return d
    return DEFAULT_DENSITY


def packages_needed(
    need_amount: float | None, need_unit: str, product_name: str, ingredient_name: str = ""
) -> int:
    """How many of this product to put in the cart. Always at least 1, always rounds up."""
    if need_amount is None or need_amount <= 0:
        return 1
    size = parse_size(product_name)
    need = to_quantity(need_amount, need_unit)

    if size is None:
        # Unknown package size: buy one per counted item ("2 cans"), else one package.
        return max(1, math.ceil(need_amount)) if need is None and need_unit.lower() in {
            "can", "cans", "box", "boxes", "jar", "jars", "package", "packages", "bag", "bags", "bottle", "bottles"
        } else 1

    n, unit = size
    if unit == "ct":
        # "6 ct" eggs for "8 eggs" -> 2 packs. Measured needs ("1 cup") just get one pack.
        return max(1, math.ceil(need_amount / n)) if need is None else 1

    if unit == "oz" and need is not None and need.check("[volume]"):
        # Liquids are often labeled "32 oz" when they mean fluid ounces (broth, milk, juice).
        unit = "fl oz"
    pkg = _size_quantity(n, unit)
    if pkg is None or need is None:
        # Count need vs. weight package: "1 onion" vs "3 lb bag" -> one bag.
        # "2 cans" vs a single "28 oz" can -> two.
        if need is None and need_unit.lower() in {"can", "cans", "jar", "jars", "box", "boxes", "bottle", "bottles", "package", "packages"}:
            return max(1, math.ceil(need_amount))
        return 1

    try:
        if need.dimensionality == pkg.dimensionality:
            ratio = (need / pkg).to("dimensionless").magnitude
        else:
            d = density_for(ingredient_name) * ureg("gram / milliliter")
            if need.check("[volume]"):
                ratio = ((need * d) / pkg).to("dimensionless").magnitude
            else:
                ratio = ((need / d) / pkg).to("dimensionless").magnitude
    except Exception:
        return 1
    # Small tolerance so 32.0001 oz doesn't become two packs because of float noise.
    return max(1, math.ceil(ratio - 1e-6))
