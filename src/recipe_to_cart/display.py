"""How amounts look to people: "1/3 cup", "1 1/2 cups", "2 tbsp", "28 oz"."""
from __future__ import annotations

from fractions import Fraction

# unit as stored -> (singular, plural)
_UNIT_NAMES = {
    "teaspoon": ("tsp", "tsp"), "tsp": ("tsp", "tsp"), "t": ("tsp", "tsp"),
    "tablespoon": ("tbsp", "tbsp"), "tbsp": ("tbsp", "tbsp"), "tbs": ("tbsp", "tbsp"), "tbl": ("tbsp", "tbsp"),
    "cup": ("cup", "cups"), "c": ("cup", "cups"), "c.": ("cup", "cups"),
    "fluid_ounce": ("fl oz", "fl oz"), "fluid ounce": ("fl oz", "fl oz"), "fl oz": ("fl oz", "fl oz"),
    "ounce": ("oz", "oz"), "oz": ("oz", "oz"),
    "pound": ("lb", "lbs"), "lb": ("lb", "lbs"), "lbs": ("lb", "lbs"),
    "gram": ("g", "g"), "g": ("g", "g"), "kilogram": ("kg", "kg"), "kg": ("kg", "kg"),
    "milliliter": ("ml", "ml"), "ml": ("ml", "ml"), "liter": ("L", "L"), "l": ("L", "L"),
    "quart": ("qt", "qt"), "qt": ("qt", "qt"), "pint": ("pt", "pt"), "pt": ("pt", "pt"),
    "gallon": ("gal", "gal"), "gal": ("gal", "gal"),
}

# Other units ("can", "stalk", "clove", "box") read fine as words; just pluralize them.
_PLURALS = {"box": "boxes", "bunch": "bunches", "pinch": "pinches", "dash": "dashes", "leaf": "leaves"}


def format_quantity(q: float) -> str:
    """0.333 -> "1/3", 1.5 -> "1 1/2", 2.0 -> "2"."""
    # Only kitchen fractions: halves, thirds, quarters, eighths.
    frac = min(
        (Fraction(round(q * d), d) for d in (1, 2, 3, 4, 8)), key=lambda f: abs(float(f) - q)
    )
    if abs(float(frac) - q) > 0.02:
        return f"{q:.2f}".rstrip("0").rstrip(".")
    whole, rest = divmod(frac.numerator, frac.denominator)
    if rest == 0:
        return str(whole)
    part = f"{rest}/{frac.denominator}"
    return f"{whole} {part}" if whole else part


def format_unit(unit: str, quantity: float | None) -> str:
    unit = (unit or "").strip()
    plural = quantity is not None and quantity > 1
    names = _UNIT_NAMES.get(unit.lower())
    if names:
        return names[1] if plural else names[0]
    singular = unit[:-1] if unit.endswith("s") and not unit.endswith("ss") else unit
    if not singular:
        return ""
    return _PLURALS.get(singular, singular + "s") if plural else singular


def format_amount(quantity: float | None, unit: str) -> str:
    if quantity is None:
        return ""
    return f"{format_quantity(quantity)} {format_unit(unit, quantity)}".strip()
