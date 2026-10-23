"""Turn ingredient lines like "2 lbs beef chuck, cubed" into structured Ingredients.

Uses ingredient-parser-nlp, which runs locally (no API calls, no cost).
"""
from __future__ import annotations

import re

from ingredient_parser import parse_ingredient

from .models import Ingredient

# Words recipe sites put in front of countable items that are not part of the product name.
_FILLER_PREFIXES = re.compile(r"^(whole|large|medium|small|med\.?)\s+", re.I)
_SIZE_PREFIXES = re.compile(r"^(large|medium|small|med\.?)\s+", re.I)
_TO_TASTE = re.compile(r"\bto taste\b|\bas needed\b", re.I)
_OPTIONAL = re.compile(r"\boptional\b", re.I)


def clean_name(name: str, strip_whole: bool = True) -> str:
    """Drop "whole"/size words that recipes put before counted items ("1 whole Medium Onion").

    Keep "whole" when the item has a unit, since "1 can Whole Tomatoes" is a product name.
    """
    pattern = _FILLER_PREFIXES if strip_whole else _SIZE_PREFIXES
    name = name.strip(" ,.;:")
    # Strip repeatedly: "whole Medium Onion" -> "Onion".
    while True:
        stripped = pattern.sub("", name)
        if stripped == name:
            return name
        name = stripped


def parse_line(line: str) -> list[Ingredient]:
    """Parse one ingredient line. Returns several Ingredients for lines like "Salt and pepper"."""
    line = line.strip()
    if not line:
        return []
    parsed = parse_ingredient(line)
    quantity: float | None = None
    unit = ""
    if parsed.amount:
        amount = parsed.amount[0]
        try:
            # Ranges like "2-3 carrots" use the upper bound so we never buy too little.
            q = amount.quantity_max if getattr(amount, "RANGE", False) else amount.quantity
            quantity = float(q) if q not in (None, "") else None
        except (TypeError, ValueError):
            quantity = None
        unit = str(amount.unit or "")
    prep = parsed.preparation.text if parsed.preparation else ""
    to_taste = bool(_TO_TASTE.search(line))
    optional = bool(_OPTIONAL.search(line))
    names = [clean_name(n.text, strip_whole=not unit) for n in (parsed.name or []) if n.text.strip()]
    if not names:
        names = [clean_name(line)]
    return [
        Ingredient(
            raw=line,
            name=n,
            quantity=quantity,
            unit=unit,
            prep=prep,
            to_taste=to_taste,
            optional=optional,
        )
        for n in names
    ]


def parse_lines(lines: list[str]) -> list[Ingredient]:
    out: list[Ingredient] = []
    for line in lines:
        out.extend(parse_line(line))
    return out
