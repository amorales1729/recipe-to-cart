"""Merge ingredients from one or more recipes into a grocery list."""
from __future__ import annotations

import re

from .models import GroceryItem, Recipe
from .spices import is_spice
from .units import to_quantity

DEFAULT_PANTRY = ["water", "ice"]

# Plain salt and black pepper are left off every list. Fresh peppers (bell, jalapeno, poblano)
# are groceries; dried ones (cayenne, red pepper flakes) go on the spice list.
_ALWAYS_EXCLUDED = re.compile(
    r"^(?:(?:kosher|sea|table|fine|coarse|flaky|iodized)\s+)?salt$"
    r"|^(?:(?:fresh|freshly)\s+)?(?:(?:ground|cracked)\s+)?(?:black\s+)?pepper$"
)


def is_always_excluded(name: str) -> bool:
    return bool(_ALWAYS_EXCLUDED.match(ingredient_key(name)))


def ingredient_key(name: str) -> str:
    """Normalize a name so "Green Bell Peppers" and "green bell pepper" merge."""
    words = re.sub(r"[^a-z0-9 ]+", " ", name.lower()).split()
    if not words:
        return ""
    last = words[-1]
    if len(last) > 3:
        if last.endswith("oes"):
            last = last[:-2]
        elif last.endswith("ies"):
            last = last[:-3] + "y"
        elif last.endswith("s") and not last.endswith("ss"):
            last = last[:-1]
    words[-1] = last
    return " ".join(words)


def build_grocery_list(recipes: list[Recipe], pantry: list[str] | None = None) -> list[GroceryItem]:
    pantry_keys = {ingredient_key(p) for p in (pantry if pantry is not None else DEFAULT_PANTRY)}
    items: list[GroceryItem] = []

    for recipe in recipes:
        for ing in recipe.ingredients:
            key = ingredient_key(ing.name)
            if not key or is_always_excluded(ing.name):
                continue
            existing = next(
                (it for it in items if it.key == key and _can_merge(it, ing.quantity, ing.unit)), None
            )
            if existing is None:
                items.append(
                    GroceryItem(
                        key=key,
                        name=ing.name,
                        quantity=ing.quantity,
                        unit=ing.unit,
                        sources=[recipe.title],
                        skip_reason="pantry" if key in pantry_keys else "",
                        category="spice" if is_spice(ing.name, ing.unit, ing.raw) else "grocery",
                    )
                )
                continue
            _merge(existing, ing.quantity, ing.unit)
            if recipe.title not in existing.sources:
                existing.sources.append(recipe.title)
    return items


def _can_merge(item: GroceryItem, quantity: float | None, unit: str) -> bool:
    if item.quantity is None or quantity is None:
        return True
    if (item.unit or "").lower() == (unit or "").lower():
        return True
    a, b = to_quantity(1, item.unit), to_quantity(1, unit)
    return a is not None and b is not None and a.dimensionality == b.dimensionality


def _merge(item: GroceryItem, quantity: float | None, unit: str) -> None:
    if quantity is None:
        return
    if item.quantity is None:
        item.quantity, item.unit = quantity, unit
        return
    if (item.unit or "").lower() == (unit or "").lower():
        item.quantity += quantity
        return
    extra = to_quantity(quantity, unit)
    if extra is None:
        return
    item.quantity += extra.to(to_quantity(1, item.unit).units).magnitude
