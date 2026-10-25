"""Walmart cart filling with Playwright, driving a browser window on your own computer.

How it stays safe and free:
- Uses a dedicated browser profile you log in to once; your password is never stored by this code.
- Only searches, opens product pages, and presses "Add to cart" / "+". It never opens checkout:
  every navigation to a checkout or payment URL is aborted (see base.is_blocked_url).
- Goes at a human pace. If Walmart shows a "Robot or human?" check, you solve it in the window.
"""
from __future__ import annotations

import json
import random
import re
import time
from pathlib import Path
from typing import Callable
from urllib.parse import quote_plus

from .base import Product, is_blocked_url

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


class WalmartCart:
    """Context manager around a visible browser window. Use:

        with WalmartCart(profile_dir) as cart:
            products = cart.search("heavy cream")
            cart.add_to_cart(products[0], 2)
    """

    name = "walmart"
    store_brands = STORE_BRANDS

    def __init__(
        self,
        profile_dir: Path,
        browser: str = "chrome",
        wait_for_user: Callable[[str], None] = lambda msg: input(msg),
        headless: bool = False,
    ):
        self.headless = headless
        self.profile_dir = Path(profile_dir)
        self.browser = browser
        self.wait_for_user = wait_for_user
        self._pw = None
        self._ctx = None
        self.page = None

    def __enter__(self) -> "WalmartCart":
        from playwright.sync_api import sync_playwright

        self.profile_dir.mkdir(parents=True, exist_ok=True)
        self._pw = sync_playwright().start()
        kwargs = dict(user_data_dir=str(self.profile_dir), headless=self.headless, viewport=None)
        if self.browser in ("msedge", "chrome"):
            kwargs["channel"] = self.browser
        self._ctx = self._pw.chromium.launch_persistent_context(**kwargs)
        self._ctx.route("**/*", self._guard)
        self.page = self._ctx.pages[0] if self._ctx.pages else self._ctx.new_page()
        return self

    def __exit__(self, *exc) -> None:
        if self._ctx:
            self._ctx.close()
        if self._pw:
            self._pw.stop()

    @staticmethod
    def _guard(route, request) -> None:
        if request.is_navigation_request() and is_blocked_url(request.url):
            print(f"  [blocked] refused to open {request.url} (this tool never checks out)")
            route.abort()
        else:
            route.continue_()

    def _pause(self, low: float = 1.5, high: float = 3.5) -> None:
        time.sleep(random.uniform(low, high))

    def ensure_logged_in(self) -> None:
        self.page.goto(BASE, wait_until="domcontentloaded")
        self._pause()
        self.wait_for_user(
            "\nIn the browser window, make sure you're signed in to Walmart and your store/pickup "
            "location is set.\nPress Enter here when ready... "
        )

    def search(self, query: str) -> list[Product]:
        for attempt in range(2):
            self.page.goto(search_url(query), wait_until="domcontentloaded")
            self._pause()
            products = parse_search_html(self.page.content())
            if products:
                return products
            if attempt == 0 and self._looks_like_bot_check():
                self.wait_for_user(
                    "\nWalmart is showing a 'Robot or human?' check. Solve it in the browser, then press Enter... "
                )
        return []

    def _looks_like_bot_check(self) -> bool:
        text = self.page.content().lower()
        return "robot or human" in text or "px-captcha" in text or "/blocked" in self.page.url

    def add_to_cart(self, product: Product, quantity: int) -> bool:
        """Open the product page, press Add to cart, then + until the quantity is right.

        If Walmart's page layout has changed and a button can't be found, asks you to do that
        step by hand in the open window instead of guessing.
        """
        page = self.page
        page.goto(product.url, wait_until="domcontentloaded")
        self._pause()

        add = page.locator('button[data-automation-id="atc"]').or_(
            page.get_by_role("button", name=re.compile(r"^\s*add to cart", re.I))
        ).first
        try:
            add.click(timeout=10_000)
        except Exception:
            self.wait_for_user(
                f"\nCouldn't find the Add to cart button for '{product.name}'. Add {quantity} to the cart "
                "by hand in the browser, then press Enter... "
            )
            return False
        self._pause(2, 4)

        for _ in range(quantity - 1):
            plus = page.get_by_role("button", name=re.compile(r"increase quantity|add one|^\+$", re.I)).first
            try:
                plus.click(timeout=8_000)
            except Exception:
                self.wait_for_user(
                    f"\nAdded 1 '{product.name}', but couldn't find the + button. Set the quantity to "
                    f"{quantity} by hand in the browser, then press Enter... "
                )
                return False
            self._pause(1.2, 2.5)
        return True

    def open_cart(self) -> None:
        self.page.goto(f"{BASE}/cart", wait_until="domcontentloaded")
