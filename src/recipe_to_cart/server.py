"""Local helper server for the Chrome extension.

`rtc cart 1 2` builds the grocery list and serves it at http://127.0.0.1:8765 so the
"Recipe to Cart" Chrome extension can fill your Walmart cart inside your normal,
signed-in Chrome. The extension does the browsing; this server does the thinking
(product ranking, package math, remembering your picks) so that logic stays in
tested Python.

Requests from web pages are refused (see _allowed_origin), and it listens on
127.0.0.1 only, so nothing outside your PC can reach it.
"""
from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, HTTPServer

from .db import ProductChoice, Store
from .models import GroceryItem
from .stores.base import Product, pick_product
from .stores.walmart import STORE_BRANDS, parse_search_html, search_url
from .units import packages_needed

DEFAULT_PORT = 8765
STORE_NAME = "walmart"
MAX_OPTIONS = 5


class CartSession:
    """Everything the extension needs for one cart run. Pure logic, no HTTP, easy to test."""

    def __init__(self, store: Store, recipes: list[str], items: list[GroceryItem], spices: list[GroceryItem]):
        self.store = store
        self.recipes = recipes
        self.items = {i.key: i for i in items}
        self.spices = spices
        self.done = False

    def plan(self) -> dict:
        out = []
        for item in self.items.values():
            saved = self.store.get_choice(STORE_NAME, item.key)
            entry = {
                "key": item.key,
                "name": item.name,
                "amount": item.amount_text,
                "search_url": search_url(item.name),
                "saved": None,
            }
            if saved:
                entry["saved"] = self._option(
                    item, Product(id=saved.product_id, name=saved.product_name, url=saved.product_url)
                )
            out.append(entry)
        return {
            "recipes": self.recipes,
            "items": out,
            "spices": [{"name": s.name, "amount": s.amount_text} for s in self.spices],
        }

    def pick(self, key: str, search_html: str) -> dict:
        item = self.items.get(key)
        if item is None:
            raise KeyError(key)
        products = parse_search_html(search_html)
        ranked = pick_product(products, item.name, STORE_BRANDS)[:MAX_OPTIONS]
        return {"key": key, "options": [self._option(item, p) for p in ranked]}

    def save_choices(self, choices: list[dict]) -> int:
        saved = 0
        for c in choices:
            if c.get("key") in self.items and c.get("id") and c.get("url", "").startswith("https://www.walmart.com/"):
                self.store.save_choice(
                    STORE_NAME, c["key"], ProductChoice(str(c["id"]), str(c.get("name", "")), c["url"])
                )
                saved += 1
        return saved

    @staticmethod
    def _option(item: GroceryItem, p: Product) -> dict:
        return {
            "id": p.id,
            "name": p.name,
            "url": p.url,
            "price": p.price,
            "available": p.available,
            "qty": packages_needed(item.quantity, item.unit, p.name, item.name),
        }


def _allowed_origin(origin: str | None) -> bool:
    """Web pages always send an Origin header to another site, so a website can't use this.

    Chrome extension pages send chrome-extension://..., or no Origin at all for simple
    requests their host permissions cover. Programs on this PC send none either.
    """
    return origin is None or origin.startswith("chrome-extension://")


def make_handler(session: CartSession):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):  # keep the console quiet
            pass

        def _send(self, status: int, body: dict | None = None):
            data = json.dumps(body or {}).encode()
            self.send_response(status)
            origin = self.headers.get("Origin")
            if origin and _allowed_origin(origin):
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _origin_ok(self) -> bool:
            if not _allowed_origin(self.headers.get("Origin")):
                self._send(403, {"error": "Only the Recipe to Cart extension can use this."})
                return False
            return True

        def _json(self) -> dict:
            length = int(self.headers.get("Content-Length") or 0)
            return json.loads(self.rfile.read(length) or b"{}")

        def do_OPTIONS(self):
            if self._origin_ok():
                self._send(204)

        def do_GET(self):
            if not self._origin_ok():
                return
            if self.path == "/plan":
                self._send(200, session.plan())
            else:
                self._send(404, {"error": "not found"})

        def do_POST(self):
            if not self._origin_ok():
                return
            try:
                body = self._json()
                if self.path == "/pick":
                    self._send(200, session.pick(body["key"], body.get("html", "")))
                elif self.path == "/choices":
                    self._send(200, {"saved": session.save_choices(body.get("choices", []))})
                elif self.path == "/done":
                    session.done = True
                    self._send(200, {"ok": True})
                else:
                    self._send(404, {"error": "not found"})
            except (KeyError, ValueError) as e:
                self._send(400, {"error": f"bad request: {e}"})

    return Handler


def serve(session: CartSession, port: int = DEFAULT_PORT) -> None:
    httpd = HTTPServer(("127.0.0.1", port), make_handler(session))
    httpd.timeout = 1
    try:
        while not session.done:
            httpd.handle_request()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
