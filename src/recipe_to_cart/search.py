"""Turn recipe wording into what a grocery store calls the product.

"1 whole Cut Up Fryer Chicken" -> "whole chicken cut up"
"2 whole Fresh Jalapenos"      -> "jalapeno peppers"
"1 can Whole Tomatoes"         -> "whole peeled tomatoes canned"

You can also set your own search for any ingredient from the extension's review page;
that is saved and always wins (see Store.get_search_term).
"""
from __future__ import annotations

import re

# Checked in order against the cleaned, lowercased name. First match wins.
_SYNONYMS: list[tuple[str, str]] = [
    (r"\bfryer\b|\bcut[- ]?up (whole )?chicken\b|\bwhole chicken,? cut[- ]?up\b|^chicken,? cut[- ]?up$", "whole chicken cut up"),
    (r"^whole chicken$|^roasting chicken$|^roaster$", "whole chicken"),
    (r"^(boneless,? )?(skinless,? )?chicken breasts?( halves)?$", "boneless skinless chicken breast"),
    (r"^(boneless,? )?(skinless,? )?chicken thighs?$", "chicken thighs"),
    (r"^heavy (whipping )?cream$|^whipping cream$", "heavy whipping cream"),
    (r"^half[- ]and[- ]half$", "half and half"),
    (r"^jalape[nñ]os?( peppers?)?$|^jalape[nñ]o chil(e|i)s?$", "jalapeno peppers"),
    (r"^(green|red|yellow|orange) bell peppers?$", r"\1 bell pepper"),
    (r"^bell peppers?$", "green bell pepper"),
    (r"^onions?$|^yellow onions?$|^brown onions?$", "yellow onion"),
    (r"^scallions?$|^green onions?$|^spring onions?$", "green onions"),
    (r"^celery( stalks?| ribs?| sticks?)?$|^stalks? celery$", "celery"),
    (r"^garlic( cloves?)?$|^cloves? (of )?garlic$", "fresh garlic"),
    (r"^ginger( root)?$|^fresh ginger( root)?$", "fresh ginger root"),
    (r"^eggs?$|^large eggs?$", "large eggs"),
    (r"^(unsalted )?butter$", r"\1butter"),
    (r"parmesan( cheese)? (shavings|shaved)|^shaved parmesan", "shaved parmesan cheese"),
    (r"^(grated|freshly grated) parmesan( cheese)?$|^parmesan( cheese)?$", "grated parmesan cheese"),
    (r"^whole tomatoes$|^whole peeled tomatoes$", "whole peeled tomatoes"),
    (r"^diced tomatoes$", "diced tomatoes"),
    (r"^tomato paste$", "tomato paste"),
    (r"^(kosher|sea) salt$", r"\1 salt"),
    (r"^lemons?$", "lemon"),
    (r"^limes?$", "lime"),
    (r"^potatoes$|^russet potatoes?$", "russet potatoes"),
    (r"^carrots?$", "carrots"),
]

_HERBS = {
    "oregano", "basil", "thyme", "rosemary", "sage", "dill", "parsley", "cilantro", "mint",
    "chives", "tarragon", "marjoram", "ginger",
}
_DROP_WORDS = re.compile(r"\b(large|medium|small|med|organic|ripe|good quality|good-quality|best)\b", re.I)
_CANNED_UNITS = {"can", "cans", "tin", "tins"}


def search_query(name: str, unit: str = "") -> str:
    """The text to type into the store's search box for this ingredient."""
    q = re.sub(r"\([^)]*\)", " ", name.lower())  # drop "(very short pasta)" style notes
    q = re.sub(r"[^a-z0-9ñ ,'-]+", " ", q)
    is_herb = any(h in q.split() for h in _HERBS)
    q = _DROP_WORDS.sub(" ", q)
    if not is_herb:
        q = re.sub(r"\bfresh\b", " ", q)
    q = re.sub(r"\s+", " ", q).strip(" ,-")

    for pattern, replacement in _SYNONYMS:
        m = re.search(pattern, q)
        if m:
            q = m.expand(replacement) if "\\" in replacement else replacement
            q = re.sub(r"\s+", " ", q).strip()
            break

    if (unit or "").lower() in _CANNED_UNITS and "canned" not in q:
        q = f"{q} canned"
    return q or name
