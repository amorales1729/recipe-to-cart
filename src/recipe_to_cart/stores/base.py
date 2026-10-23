"""Shared store types, product picking, and the never-check-out guard."""
from __future__ import annotations

import re
from dataclasses import dataclass
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


def score_product(product: Product, ingredient_name: str, store_brands: tuple[str, ...] = ()) -> float:
    """Higher is better. Simple rules, no AI: name overlap, store brand, avoid flavored or prepared items."""
    want = set(re.findall(r"[a-z]+", ingredient_name.lower()))
    have = set(re.findall(r"[a-z]+", product.name.lower()))
    if not want:
        return 0.0
    score = 10.0 * len(want & have) / len(want)
    title = product.name.lower()
    for word in _AVOID_WORDS:
        if word in title and word not in ingredient_name.lower():
            score -= 4
    if any(title.startswith(b) for b in store_brands):
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
