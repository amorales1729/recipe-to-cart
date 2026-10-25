import { readFileSync } from "node:fs";

export const fixture = (name) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");

/** The JSON-LD blocks of a saved page, the way readRecipePage() collects them in Chrome. */
export function pageFromHtml(html, url = "https://example.com/recipe") {
  const jsonld = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  return { url, title: "", jsonld, selection: "" };
}
