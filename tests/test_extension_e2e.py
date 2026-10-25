"""End-to-end test of the Chrome extension against a fake walmart.com.

Loads extension/ into Chromium, serves fake Walmart search and product pages, runs the
local app server, and checks that the right products land in the "cart" and that
checkout is never opened.

Skipped unless RTC_E2E_CHROMIUM points at a Chromium binary, e.g.
    RTC_E2E_CHROMIUM=/path/to/chromium pytest tests/test_extension_e2e.py
"""
import json
import os
import threading
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest

CHROMIUM = os.environ.get("RTC_E2E_CHROMIUM")
pytestmark = pytest.mark.skipif(not CHROMIUM, reason="set RTC_E2E_CHROMIUM to run")

REPO = Path(__file__).resolve().parent.parent

PRODUCT_PAGE = """<html><body><div id=q>0</div>
<button data-automation-id="atc" onclick="q.textContent=1;this.remove();p.hidden=false;fetch('/__test/added?id=ID')">Add to cart</button>
<button id=p hidden aria-label="Increase quantity, Current Quantity" onclick="q.textContent=+q.textContent+1;fetch('/__test/added?id=ID')">+</button>
<a href="/checkout">Check out</a></body></html>"""


def _search_page(q):
    pid = str(abs(hash(q)) % 100000)
    items = [
        {"__typename": "Product", "usItemId": pid + "1", "name": f"Fancy Flavored {q} Snack, 4 oz",
         "canonicalUrl": f"/ip/x/{pid}1", "price": 9.99},
        {"__typename": "Product", "usItemId": pid + "2", "name": f"Great Value {q}, 32 oz",
         "canonicalUrl": f"/ip/y/{pid}2", "price": 2.50},
    ]
    data = {"props": {"pageProps": {"initialData": {"searchResult": {"itemStacks": [{"items": items}]}}}}}
    return f'<html><body><script id="__NEXT_DATA__" type="application/json">{json.dumps(data)}</script></body></html>'


def _wait(cond, seconds, page=None):
    # With a page, wait via Playwright so its event loop keeps running (route handlers fire).
    end = time.time() + seconds
    while time.time() < end:
        if cond():
            return True
        page.wait_for_timeout(250) if page else time.sleep(0.25)
    return False


def test_extension_fills_cart(tmp_path):
    from playwright.sync_api import sync_playwright

    from recipe_to_cart import extract
    from recipe_to_cart.db import Store
    from recipe_to_cart.grocery import build_grocery_list
    from recipe_to_cart.server import CartSession, serve

    result = {}

    def run_server():  # sqlite objects must stay on one thread
        store = Store(tmp_path / "t.db")
        recipe = extract.from_html((REPO / "tests/fixtures/italian_chicken_soup.html").read_text(), "u")
        items = [i for i in build_grocery_list([recipe]) if i.category == "grocery"]
        wanted = [i for i in items if i.name in ("Ditalini Pasta", "Low Sodium Chicken Broth")]
        result["session"] = CartSession(store, [recipe.title], wanted, [])
        serve(result["session"])
        result["saved"] = [tuple(r) for r in store.conn.execute("SELECT ingredient_key, product_id FROM product_choices")]

    server = threading.Thread(target=run_server, daemon=True)
    server.start()
    assert _wait(lambda: "session" in result, 10)

    added, checkout_hits = [], []

    def fake_walmart(route):
        url = route.request.url
        path = urlparse(url).path
        if path.startswith("/__test/added"):
            added.append(parse_qs(urlparse(url).query)["id"][0])
            return route.fulfill(body="ok")
        if path.startswith("/checkout"):
            checkout_hits.append(url)
        if path == "/search":
            return route.fulfill(content_type="text/html", body=_search_page(parse_qs(urlparse(url).query)["q"][0]))
        if path.startswith("/ip/"):
            return route.fulfill(content_type="text/html", body=PRODUCT_PAGE.replace("ID", path.rsplit("/", 1)[-1]))
        return route.fulfill(content_type="text/html", body=f"<html><body>{path}</body></html>")

    ext = str(REPO / "extension")
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(tmp_path / "profile"), headless=True, executable_path=CHROMIUM,
            args=[f"--disable-extensions-except={ext}", f"--load-extension={ext}", "--headless=new"],
        )
        try:
            ctx.route("https://www.walmart.com/**", fake_walmart)
            assert _wait(lambda: ctx.service_workers, 10)
            ext_id = ctx.service_workers[0].url.split("/")[2]
            page = ctx.new_page()
            page.goto(f"chrome-extension://{ext_id}/cart.html")

            selects = page.locator("#rows select")
            assert _wait(lambda: selects.count() == 2 and page.inner_text("#status").strip() == "", 60, page)
            names = [selects.nth(i).locator("option:checked").inner_text() for i in range(2)]
            assert all(n.startswith("Great Value") for n in names), names  # not the flavored snack
            qtys = [page.locator("#rows input[type=number]").nth(i).input_value() for i in range(2)]
            assert qtys == ["1", "2"]  # 1 box pasta; 8 cups broth = two 32 oz cartons

            page.click("#add")
            assert _wait(lambda: "Added 2 of 2" in page.inner_text("#status"), 90, page)
            assert len(added) == 3  # pasta once, broth twice
            assert _wait(lambda: any(pg.url == "https://www.walmart.com/cart" for pg in ctx.pages), 10, page)
            assert checkout_hits == []
        finally:
            ctx.close()

    server.join(5)
    assert result["session"].done
    assert len(result["saved"]) == 2
