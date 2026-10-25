import json
import threading
import urllib.error
import urllib.request

from recipe_to_cart.db import Store
from recipe_to_cart.models import GroceryItem
from recipe_to_cart.server import CartSession, make_handler

from http.server import HTTPServer


def _session(tmp_path):
    store = Store(tmp_path / "t.db")
    items = [GroceryItem(key="heavy cream", name="Heavy Cream", quantity=2, unit="cup")]
    spices = [GroceryItem(key="ground cumin", name="ground cumin", quantity=1, unit="teaspoon", category="spice")]
    return store, CartSession(store, ["Soup"], items, spices)


def test_plan_pick_and_save(tmp_path, fixture_text):
    store, session = _session(tmp_path)
    plan = session.plan()
    assert plan["recipes"] == ["Soup"]
    assert plan["items"][0]["amount"] == "2 cups" and plan["items"][0]["saved"] is None
    assert plan["items"][0]["query"] == "heavy whipping cream"  # Walmart's wording
    assert plan["items"][0]["search_url"] == "https://www.walmart.com/search?q=heavy+whipping+cream"
    assert plan["spices"] == [{"name": "ground cumin", "amount": "1 tsp"}]

    options = session.pick("heavy cream", fixture_text("walmart_search.html"))["options"]
    best = options[0]
    assert best["id"] == "222" and best["qty"] == 1  # 2 cups fits one 32 fl oz carton
    assert best["cheapest"] and not best["usual"]
    assert not any(o["cheapest"] for o in options[1:])

    assert session.save_choices([{"key": "heavy cream", **best}]) == 1
    # Junk is ignored: unknown ingredient, non-Walmart URL.
    assert session.save_choices([{"key": "nope", **best}, {"key": "heavy cream", "id": "1", "url": "https://evil.example/"}]) == 0
    saved = session.plan()["items"][0]["saved"]
    assert saved["id"] == "222" and saved["qty"] == 1
    # Next time it's searched, your usual product is labeled.
    options = session.pick("heavy cream", fixture_text("walmart_search.html"))["options"]
    assert options[0]["usual"] and options[0]["cheapest"]


def _serve(session):
    httpd = HTTPServer(("127.0.0.1", 0), make_handler(session))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_port}"


def _get(url, origin=None):
    req = urllib.request.Request(url, headers={"Origin": origin} if origin else {})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, None


def test_web_pages_are_refused_extension_allowed(tmp_path):
    store = Store(tmp_path / "t.db")
    session = CartSession(store, ["Soup"], [], [])
    store.close()
    session.store = None  # plan() with no items never touches the database
    httpd, base = _serve(session)
    try:
        assert _get(base + "/plan", origin="https://evil.example")[0] == 403
        assert _get(base + "/plan", origin="chrome-extension://abcdef")[0] == 200
        assert _get(base + "/plan")[0] == 200
        assert _get(base + "/nope")[0] == 404
    finally:
        httpd.shutdown()


def test_typed_search_is_remembered(tmp_path, fixture_text):
    store, session = _session(tmp_path)
    session.pick("heavy cream", fixture_text("walmart_search.html"), query="great value heavy cream")
    item = session.plan()["items"][0]
    assert item["query"] == "great value heavy cream"
    assert item["search_url"].endswith("q=great+value+heavy+cream")
