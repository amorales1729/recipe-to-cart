"""Walmart search-page parsing.

The cart itself is filled by the Recipe to Cart Chrome extension, inside your normal
signed-in Chrome (see extension/). The extension sends Walmart's search page here to be
read, so the parsing and ranking stay in tested Python.
"""
from __future__ import annotations

import json
import re
from urllib.parse import quote_plus

from .base import Product

BASE = "https://www.walmart.com"
STORE_BRANDS = ("great value", "marketside", "freshness guaranteed", "sam's choice")
_NEXT_DATA = re.compile(r'<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)


def search_url(query: str) -> str:
    return f"{BASE}/search?q={quote_plus(query)}"


def parse_search_html(html: str) -> list[Product]:
    """Read products from the JSON Walmart embeds in its search page (more stable than CSS)."""
    m = _NEXT_DATA.search(html)
    if not m:
        return []
    try:
        data = json.loads(m.group(1))
    except json.JSONDecodeError:
        return []
    products: list[Product] = []
    seen: set[str] = set()
    for item in _walk_items(data):
        pid = str(item.get("usItemId") or "")
        name = item.get("name") or ""
        if not pid or not name or pid in seen:
            continue
        seen.add(pid)
        url = item.get("canonicalUrl") or f"/ip/{pid}"
        if url.startswith("/"):
            url = BASE + url
        products.append(
            Product(
                id=pid,
                name=name,
                url=url.split("?")[0],
                price=_price(item),
                available=_available(item),
                sponsored=bool(item.get("isSponsoredFlag")),
            )
        )
    return products


def _walk_items(obj):
    if isinstance(obj, dict):
        if "usItemId" in obj and "name" in obj and obj.get("__typename", "Product") == "Product":
            yield obj
        for v in obj.values():
            yield from _walk_items(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk_items(v)


def _price(item: dict) -> float | None:
    if isinstance(item.get("price"), (int, float)):
        return float(item["price"])
    info = item.get("priceInfo") or {}
    for key in ("currentPrice", "linePrice"):
        v = info.get(key)
        if isinstance(v, dict):
            v = v.get("price") or v.get("priceString")
        if isinstance(v, (int, float)):
            return float(v)
        if isinstance(v, str):
            m = re.search(r"\d+(?:\.\d+)?", v.replace(",", ""))
            if m:
                return float(m.group())
    return None


def _available(item: dict) -> bool:
    status = item.get("availabilityStatusV2")
    status = status.get("value", "") if isinstance(status, dict) else item.get("availabilityStatusDisplayValue", "")
    status = str(status or "").lower().replace("_", " ")
    if "out of stock" in status:
        return False
    return item.get("canAddToCart", True) is not False
