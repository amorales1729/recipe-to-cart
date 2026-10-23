from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Ingredient:
    raw: str
    name: str
    quantity: float | None = None
    unit: str = ""
    prep: str = ""
    to_taste: bool = False
    optional: bool = False


@dataclass
class Recipe:
    title: str
    ingredients: list[Ingredient]
    instructions: list[str]
    source_url: str = ""
    yields: str = ""
    raw_text: str = ""
    id: int | None = None


@dataclass
class GroceryItem:
    key: str
    name: str
    quantity: float | None
    unit: str
    sources: list[str] = field(default_factory=list)
    skip_reason: str = ""
    category: str = "grocery"  # "grocery" goes to the cart; "spice" is the spice-rack list

    @property
    def amount_text(self) -> str:
        if self.quantity is None:
            return "as needed"
        q = f"{self.quantity:g}" if self.quantity == int(self.quantity) else f"{self.quantity:.2f}".rstrip("0")
        return f"{q} {self.unit}".strip()
