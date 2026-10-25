"""Shared store types, product picking, and the never-check-out guard."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable
from urllib.parse import urlparse


@dataclass
class Product:
    id: str
    name: str
    url: str
    price: float | None = None
    available: bool = True
    sponsored: bool = False


# Any page whose path matches these is off limits. The cart script refuses to load them,
# so even a mis-click can't reach checkout or payment.
_BLOCKED_PATH = re.compile(
    r"^/(checkout|payment|payments|place-?order|wallet|account/wallet|purchase)(/|$)", re.I
)


def is_blocked_url(url: str) -> bool:
    path = urlparse(url).path or "/"
    return bool(_BLOCKED_PATH.match(path))


_AVOID_WORDS = {
    "flavored", "seasoned", "marinated", "sauce", "soup", "mix", "chips", "snack", "candy",
    "dressing", "frozen meal", "kit", "baby food", "dog", "cat", "seeds for planting",
}


def _words(text: str) -> set[str]:
    # "onions" and "onion" count as the same word.
    return {w[:-1] if len(w) > 3 and w.endswith("s") and not w.endswith("ss") else w
            for w in re.findall(r"[a-z]+", text.lower())}


def match_score(product: Product, ingredient_name: str) -> float:
    """How well the product's name matches what we searched for, out of 10. Flavored or prepared items lose points."""
    want, have = _words(ingredient_name), _words(product.name)
    if not want:
        return 0.0
    score = 10.0 * len(want & have) / len(want)
    title = product.name.lower()
    for word in _AVOID_WORDS:
        if word in title and word not in ingredient_name.lower():
            score -= 4
    return score


def score_product(product: Product, ingredient_name: str, store_brands: tuple[str, ...] = ()) -> float:
    """Higher is better. Simple rules, no AI: name overlap, store brand, avoid flavored or prepared items."""
    score = match_score(product, ingredient_name)
    if any(product.name.lower().startswith(b) for b in store_brands):
        score += 2
    if product.sponsored:
        score -= 1
    if not product.available:
        score -= 20
    return score


def pick_product(products: list[Product], ingredient_name: str, store_brands: tuple[str, ...] = ()) -> list[Product]:
    """Products ranked best first. Ties keep the store's own order (its relevance ranking)."""
    ranked = sorted(
        enumerate(products), key=lambda ip: (-score_product(ip[1], ingredient_name, store_brands), ip[0])
    )
    return [p for _, p in ranked]


# A product counts as the same thing as the best match if it's missing at most about one word of the search.
_CLOSE_MATCH = 3.4
_MIN_MATCH = 5.0


def good_matches(products: list[Product], ingredient_name: str) -> list[Product]:
    """In-stock products with a price that match the search about as well as the best one does."""
    usable = [p for p in products if p.available and p.price is not None]
    if not usable:
        return []
    best = max(match_score(p, ingredient_name) for p in usable)
    floor = max(best - _CLOSE_MATCH, _MIN_MATCH)
    return [p for p in usable if match_score(p, ingredient_name) >= floor]


def pick_cheapest(
    products: list[Product],
    ingredient_name: str,
    store_brands: tuple[str, ...] = (),
    cost: Callable[[Product], float] | None = None,
) -> tuple[list[Product], int]:
    """Good matches cheapest first, then everything else best match first.

    `cost` is what the product costs for the amount the recipe needs (price times packages),
    so a bigger package can win when you'd need two of the small one. Returns the ranked
    list and how many of the leading products are good matches (0 means none had a price).
    """
    cost = cost or (lambda p: p.price)
    ranked = pick_product(products, ingredient_name, store_brands)
    good = good_matches(ranked, ingredient_name)
    cheap = sorted(good, key=lambda p: (cost(p), ranked.index(p)))
    return cheap + [p for p in ranked if p not in good], len(cheap)
