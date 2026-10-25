"""SQLite storage: recipes, ingredients, saved product choices, and the pantry list."""
from __future__ import annotations

import os
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from .grocery import PANTRY_SEEDS, ingredient_key
from .models import Ingredient, Recipe

SCHEMA = """
CREATE TABLE IF NOT EXISTS recipes (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    source_url TEXT NOT NULL DEFAULT '',
    yields TEXT NOT NULL DEFAULT '',
    instructions TEXT NOT NULL DEFAULT '',
    raw_text TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ingredients (
    id INTEGER PRIMARY KEY,
    recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    raw TEXT NOT NULL,
    name TEXT NOT NULL,
    quantity REAL,
    unit TEXT NOT NULL DEFAULT '',
    prep TEXT NOT NULL DEFAULT '',
    to_taste INTEGER NOT NULL DEFAULT 0,
    optional INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS product_choices (
    store TEXT NOT NULL,
    ingredient_key TEXT NOT NULL,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    product_url TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (store, ingredient_key)
);
CREATE TABLE IF NOT EXISTS search_terms (
    ingredient_key TEXT PRIMARY KEY,
    query TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pantry (
    key TEXT PRIMARY KEY,
    name TEXT NOT NULL
);
"""

STEP_SEPARATOR = "\n\x1e\n"  # record separator, so steps can contain newlines


def app_home() -> Path:
    home = Path(os.environ.get("RECIPE_TO_CART_HOME", Path.home() / ".recipe-to-cart"))
    home.mkdir(parents=True, exist_ok=True)
    return home


def default_db_path() -> Path:
    return app_home() / "recipes.db"


@dataclass
class ProductChoice:
    product_id: str
    product_name: str
    product_url: str


class Store:
    def __init__(self, path: Path | str | None = None):
        self.path = str(path or default_db_path())
        self.conn = sqlite3.connect(self.path)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.conn.executescript(SCHEMA)
        self._seed_pantry()

    def _seed_pantry(self) -> None:
        """Add default pantry staples, each batch once, so items you remove stay removed."""
        version = self.conn.execute("PRAGMA user_version").fetchone()[0]
        for seed_version in sorted(PANTRY_SEEDS):
            if seed_version > version:
                for name in PANTRY_SEEDS[seed_version]:
                    self.conn.execute("INSERT OR IGNORE INTO pantry VALUES (?, ?)", (ingredient_key(name), name))
                self.conn.execute(f"PRAGMA user_version = {int(seed_version)}")
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()

    # ---- recipes ----

    def save_recipe(self, recipe: Recipe) -> int:
        with self.conn:
            cur = self.conn.execute(
                "INSERT INTO recipes (title, source_url, yields, instructions, raw_text, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (
                    recipe.title,
                    recipe.source_url,
                    recipe.yields,
                    STEP_SEPARATOR.join(recipe.instructions),
                    recipe.raw_text,
                    _now(),
                ),
            )
            recipe_id = cur.lastrowid
            self.conn.executemany(
                "INSERT INTO ingredients (recipe_id, position, raw, name, quantity, unit, prep, to_taste, optional)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    (recipe_id, i, g.raw, g.name, g.quantity, g.unit, g.prep, int(g.to_taste), int(g.optional))
                    for i, g in enumerate(recipe.ingredients)
                ],
            )
        recipe.id = recipe_id
        return recipe_id

    def find_by_url(self, url: str) -> int | None:
        row = self.conn.execute("SELECT id FROM recipes WHERE source_url = ? AND source_url != ''", (url,)).fetchone()
        return row["id"] if row else None

    def get_recipe(self, recipe_id: int) -> Recipe | None:
        row = self.conn.execute("SELECT * FROM recipes WHERE id = ?", (recipe_id,)).fetchone()
        if row is None:
            return None
        ings = [
            Ingredient(
                raw=r["raw"], name=r["name"], quantity=r["quantity"], unit=r["unit"],
                prep=r["prep"], to_taste=bool(r["to_taste"]), optional=bool(r["optional"]),
            )
            for r in self.conn.execute(
                "SELECT * FROM ingredients WHERE recipe_id = ? ORDER BY position", (recipe_id,)
            )
        ]
        steps = row["instructions"].split(STEP_SEPARATOR) if row["instructions"] else []
        return Recipe(
            id=row["id"], title=row["title"], ingredients=ings, instructions=steps,
            source_url=row["source_url"], yields=row["yields"], raw_text=row["raw_text"],
        )

    def list_recipes(self) -> list[tuple[int, str, str]]:
        return [
            (r["id"], r["title"], r["source_url"])
            for r in self.conn.execute("SELECT id, title, source_url FROM recipes ORDER BY id")
        ]

    def delete_recipe(self, recipe_id: int) -> bool:
        with self.conn:
            cur = self.conn.execute("DELETE FROM recipes WHERE id = ?", (recipe_id,))
        return cur.rowcount > 0

    # ---- product choices ----

    def get_choice(self, store: str, key: str) -> ProductChoice | None:
        row = self.conn.execute(
            "SELECT * FROM product_choices WHERE store = ? AND ingredient_key = ?", (store, key)
        ).fetchone()
        if row is None:
            return None
        return ProductChoice(row["product_id"], row["product_name"], row["product_url"])

    def save_choice(self, store: str, key: str, choice: ProductChoice) -> None:
        with self.conn:
            self.conn.execute(
                "INSERT OR REPLACE INTO product_choices VALUES (?, ?, ?, ?, ?, ?)",
                (store, key, choice.product_id, choice.product_name, choice.product_url, _now()),
            )

    # ---- your own store searches, set from the extension ----

    def get_search_term(self, key: str) -> str | None:
        row = self.conn.execute("SELECT query FROM search_terms WHERE ingredient_key = ?", (key,)).fetchone()
        return row["query"] if row else None

    def save_search_term(self, key: str, query: str) -> None:
        with self.conn:
            self.conn.execute("INSERT OR REPLACE INTO search_terms VALUES (?, ?)", (key, query.strip()))

    # ---- pantry ----

    def pantry(self) -> list[str]:
        return [r["name"] for r in self.conn.execute("SELECT name FROM pantry ORDER BY name")]

    def add_pantry(self, name: str) -> None:
        with self.conn:
            self.conn.execute("INSERT OR REPLACE INTO pantry VALUES (?, ?)", (ingredient_key(name), name))

    def remove_pantry(self, name: str) -> bool:
        with self.conn:
            cur = self.conn.execute("DELETE FROM pantry WHERE key = ?", (ingredient_key(name),))
        return cur.rowcount > 0


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
