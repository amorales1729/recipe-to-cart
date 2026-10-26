#!/usr/bin/env node
// Prints the shopping-list ingredients of a recipe page as the extension would send them to the
// Search words tab: [{key, name, guess}]. Used by the search-words task when the iPhone shortcut
// passes a recipe link along, so the searches are ready before the recipe reaches Chrome.
//
//   node tools/recipe-words.js "Try this https://example.com/soup"
//   node tools/recipe-words.js --file saved-page.html
import { readFileSync } from "node:fs";

import { DEFAULT_PANTRY } from "../extension/lib/grocery.js";
import { buildPlan } from "../extension/lib/plan.js";
import { fromHtml } from "../extension/lib/recipe.js";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

export function wordsFromHtml(html, url = "") {
  const plan = buildPlan([fromHtml(html, url)], DEFAULT_PANTRY);
  return plan.items.map((i) => ({ key: i.key, name: i.name, guess: i.query }));
}

async function main(args) {
  let html, url;
  if (args[0] === "--file") {
    html = readFileSync(args[1], "utf8");
  } else {
    // Shared text often has words around the link.
    url = (args.join(" ").match(/https?:\/\/[^\s<>"']+/i) || [""])[0].replace(/[).,!?]+$/, "");
    if (!url) throw new Error("No link found.");
    const res = await fetch(url, { headers: { "User-Agent": BROWSER_UA, Accept: "text/html" } });
    if (!res.ok) throw new Error(`The recipe site answered ${res.status}.`);
    html = await res.text();
  }
  process.stdout.write(JSON.stringify(wordsFromHtml(html, url), null, 2) + "\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
