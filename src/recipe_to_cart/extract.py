"""Get a Recipe out of a URL, saved HTML, or pasted text. All free and local."""
from __future__ import annotations

import json
import re
import urllib.request

from .ingredients import parse_lines
from .models import Recipe

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)


class ExtractionError(Exception):
    pass


def fetch_html(url: str, timeout: float = 20) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        charset = resp.headers.get_content_charset() or "utf-8"
        return resp.read().decode(charset, errors="replace")


def from_url(url: str) -> Recipe:
    return from_html(fetch_html(url), url)


def from_html(html: str, url: str) -> Recipe:
    """Try recipe-scrapers first (500+ sites), then raw schema.org JSON-LD."""
    try:
        from recipe_scrapers import scrape_html

        s = scrape_html(html, org_url=url, supported_only=False)
        title = s.title()
        lines = s.ingredients()
        steps = s.instructions_list()
        try:
            yields = s.yields() or ""
        except Exception:
            yields = ""
        if lines:
            return Recipe(
                title=title,
                ingredients=parse_lines(lines),
                instructions=steps,
                source_url=url,
                yields=yields,
            )
    except Exception:
        pass
    data = find_jsonld_recipe(html)
    if not data:
        raise ExtractionError(
            "No structured recipe found on that page. Copy the recipe text and use `rtc add --paste` instead."
        )
    return Recipe(
        title=_text(data.get("name")) or "Untitled recipe",
        ingredients=parse_lines([_text(x) for x in data.get("recipeIngredient", [])]),
        instructions=_instructions(data.get("recipeInstructions")),
        source_url=url,
        yields=_text(data.get("recipeYield")),
    )


def find_jsonld_recipe(html: str) -> dict | None:
    for block in re.findall(
        r"<script[^>]*application/ld\+json[^>]*>(.*?)</script>", html, re.S | re.I
    ):
        try:
            data = json.loads(block)
        except json.JSONDecodeError:
            continue
        found = _walk_for_recipe(data)
        if found:
            return found
    return None


def _walk_for_recipe(obj):
    if isinstance(obj, list):
        for item in obj:
            found = _walk_for_recipe(item)
            if found:
                return found
    elif isinstance(obj, dict):
        t = obj.get("@type")
        if t == "Recipe" or (isinstance(t, list) and "Recipe" in t):
            return obj
        for value in obj.values():
            found = _walk_for_recipe(value)
            if found:
                return found
    return None


def _text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return _text(value[0]) if value else ""
    if isinstance(value, dict):
        return _text(value.get("text") or value.get("name"))
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", str(value))).strip()


def _instructions(value) -> list[str]:
    if not value:
        return []
    if isinstance(value, str):
        return [s.strip() for s in re.split(r"\n+", _text_keep_lines(value)) if s.strip()]
    steps: list[str] = []
    for item in value if isinstance(value, list) else [value]:
        if isinstance(item, dict) and item.get("@type") == "HowToSection":
            steps.extend(_instructions(item.get("itemListElement")))
        else:
            text = _text(item)
            if text:
                steps.append(text)
    return steps


def _text_keep_lines(value: str) -> str:
    return re.sub(r"<[^>]+>", "\n", value)


# ---- pasted text (Apple Notes, copied web pages) ----

_ING_HEADER = re.compile(r"^\s*ingredients?\s*:?\s*$", re.I)
_STEP_HEADER = re.compile(
    r"^\s*(instructions|directions|method|steps|preparation)\s*:?\s*$", re.I
)
_BULLET = re.compile(r"^\s*([-*•▪●]|\d+[.)])\s+")
_STEP_PREFIX = re.compile(r"^\s*(step\s*\d+\s*[:.)-]?|\d+[.)])\s*", re.I)
_NUMBERED_STEP = re.compile(r"^\s*(step\s*\d+|\d+[.)])\s", re.I)
_STARTS_WITH_AMOUNT = re.compile(r"^\s*([-*•]\s*)?(\d|[¼-¾⅐-⅞]|a\s|an\s|one\s|two\s)", re.I)


def from_text(text: str, title: str | None = None) -> Recipe:
    lines = [ln.rstrip() for ln in text.splitlines()]
    nonblank = [ln for ln in lines if ln.strip()]
    if not nonblank:
        raise ExtractionError("The pasted text is empty.")

    ing_idx = next((i for i, ln in enumerate(lines) if _ING_HEADER.match(ln)), None)
    step_idx = next((i for i, ln in enumerate(lines) if _STEP_HEADER.match(ln)), None)

    if ing_idx is not None:
        end = step_idx if step_idx is not None and step_idx > ing_idx else len(lines)
        ing_lines = [_BULLET.sub("", ln).strip() for ln in lines[ing_idx + 1 : end] if ln.strip()]
        step_lines = lines[step_idx + 1 :] if step_idx is not None else []
        header = lines[:ing_idx]
    else:
        # No headings: lines that start with an amount are ingredients, longer prose is steps.
        ing_lines, step_lines, header = [], [], []
        for ln in nonblank[1:]:
            is_numbered_step = bool(_NUMBERED_STEP.match(ln))
            if _STARTS_WITH_AMOUNT.match(ln) and len(ln) < 90 and not is_numbered_step:
                ing_lines.append(_BULLET.sub("", ln).strip())
            else:
                step_lines.append(ln)
        header = nonblank[:1]

    steps = [_STEP_PREFIX.sub("", ln).strip() for ln in step_lines if ln.strip()]
    if title is None:
        title = next((ln.strip() for ln in header if ln.strip()), None) or nonblank[0].strip()
    if not ing_lines:
        raise ExtractionError(
            "Couldn't find an ingredient list. Put the ingredients under a line that says 'Ingredients'."
        )
    return Recipe(
        title=title,
        ingredients=parse_lines(ing_lines),
        instructions=steps,
        raw_text=text,
    )
