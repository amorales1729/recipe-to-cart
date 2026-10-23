"""Sort spice-rack items onto their own list, away from the grocery list and the cart.

Spice rack (own list):   ground cumin, paprika, garlic powder, 1 tsp oregano, bay leaves,
                         red pepper flakes, Italian seasoning, 2 tbsp taco seasoning
Groceries (to the cart): a packet of taco seasoning, gravy mix, onion soup mix,
                         fresh oregano, cilantro, garlic cloves, fresh ginger
"""
from __future__ import annotations

import re

# Always spice rack, whatever the amount (unless sold as a packet/mix, see below).
_SPICES = {
    "allspice", "anise", "star anise", "cardamom", "cayenne", "cayenne pepper", "celery salt",
    "celery seed", "chili powder", "chile powder", "chipotle powder", "ancho chile powder",
    "cinnamon", "ground cinnamon", "cloves", "ground cloves", "whole cloves", "coriander",
    "ground coriander", "cumin", "ground cumin", "cumin seed", "curry powder", "garam masala",
    "fennel seed", "garlic powder", "granulated garlic", "garlic salt", "onion powder",
    "onion salt", "ground ginger", "ground mustard", "dry mustard", "mustard powder",
    "mustard seed", "nutmeg", "ground nutmeg", "paprika", "smoked paprika", "sweet paprika",
    "red pepper flake", "red pepper flakes", "crushed red pepper", "crushed red pepper flake",
    "chili flake", "chili flakes", "white pepper", "black peppercorn", "peppercorn", "saffron",
    "sesame seed", "turmeric", "ground turmeric", "bay leaf", "bay leave", "italian seasoning",
    "cajun seasoning", "creole seasoning", "old bay", "old bay seasoning", "poultry seasoning",
    "seasoned salt", "lemon pepper", "everything bagel seasoning", "pumpkin pie spice",
    "apple pie spice", "herbes de provence", "za atar", "sumac", "msg", "steak seasoning",
    "taco seasoning", "fajita seasoning", "ranch seasoning", "chili seasoning", "cream of tartar",
    "dill weed", "dried dill", "dried basil", "dried oregano", "dried thyme", "dried rosemary",
    "dried parsley", "dried sage", "dried marjoram", "dried tarragon", "rubbed sage", "ground sage",
    "dried chive", "ground thyme",
}

# Herbs that are dried (spice rack) when measured in teaspoons and not called fresh.
_DRIED_BY_DEFAULT = {"oregano", "thyme", "rosemary", "sage", "marjoram", "tarragon", "basil", "dill"}
_SMALL_UNITS = {"teaspoon", "tablespoon", "pinch", "dash", "tsp", "tbsp", "t"}

# Sold as a store item even though it's a seasoning.
_PACKET = re.compile(r"\b(packets?|envelopes?|pkgs?|packages?|mix|gravy|sachets?)\b", re.I)
_PACKET_UNITS = {"packet", "packets", "envelope", "envelopes", "package", "packages", "pkg",
                 "ounce", "oz", "box", "boxes", "jar", "jars"}


def _key(name: str) -> str:
    words = re.sub(r"[^a-z ]+", " ", name.lower()).split()
    if words and len(words[-1]) > 3 and words[-1].endswith("s") and not words[-1].endswith("ss"):
        words[-1] = words[-1][:-1]
    return " ".join(words)


def is_spice(name: str, unit: str = "", raw: str = "") -> bool:
    """True if this ingredient belongs on the spice-rack list instead of the grocery list."""
    text = f"{name} {raw}".lower()
    unit = (unit or "").lower().strip()
    if _PACKET.search(text) or unit in _PACKET_UNITS:
        return False  # gravy mix, a packet of taco seasoning: buy it
    if "bay" not in text and re.search(r"\b(fresh|sprigs?|bunch(es)?|leaves)\b", text):
        return False  # fresh herbs are produce
    key = _key(name)
    stripped = re.sub(r"^(ground|dried|whole|crushed|smoked|sweet|hot|mild)\s+", "", key)
    if key in _SPICES or (stripped != key and stripped in _SPICES):
        return True
    if stripped in _DRIED_BY_DEFAULT:
        return bool(re.search(r"\b(dried|ground)\b", text)) or unit in _SMALL_UNITS
    return False
