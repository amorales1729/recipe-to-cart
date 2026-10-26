#!/usr/bin/env node
// Prints the shopping-list ingredients of a recipe page as the extension would send them to the
// Search words tab: [{key, name, guess}]. Used by the search-words task when the iPhone shortcut
// passes a recipe link along, so the searches are ready before the recipe reaches Chrome.
//
//   node tools/recipe-words.js "Try this https://example.com/soup"
//   node tools/recipe-words.js --file saved-page.html
//   node tools/recipe-words.js --shared shared.txt
//
// --shared reads what the shortcut sent. Some sites (Pioneer Woman, for one) refuse downloads from
// the cloud, so the shortcut reads the ingredient list on the phone and sends it under an
// "Ingredients" line after the link. Without that list it falls back to downloading the link.
import { readFileSync } from "node:fs";

import { DEFAULT_PANTRY } from "../extension/lib/grocery.js";
import { buildPlan } from "../extension/lib/plan.js";
import { fromHtml, fromText } from "../extension/lib/recipe.js";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

function words(recipe) {
  const plan = buildPlan([recipe], DEFAULT_PANTRY);
  return plan.items.map((i) => ({ key: i.key, name: i.name, guess: i.query }));
}

export function wordsFromHtml(html, url = "") {
  return words(fromHtml(html, url));
}

// The shortcut's text: a link, then optionally the recipe's ingredient lines under "Ingredients".
export function wordsFromShared(text) {
  return /^\s*ingredients?\s*:?\s*$/im.test(text) ? words(fromText(text)) : null;
}

function findLink(text) {
  // Shared text often has words around the link.
  return (text.match(/https?:\/\/[^\s<>"']+/i) || [""])[0].replace(/[).,!?]+$/, "");
}

async function download(url) {
  if (!url) throw new Error("No link found.");
  const res = await fetch(url, { headers: { "User-Agent": BROWSER_UA, Accept: "text/html" } });
  if (!res.ok) throw new Error(`The recipe site answered ${res.status}.`);
  return res.text();
}

async function main(args) {
  let list;
  if (args[0] === "--file") {
    list = wordsFromHtml(readFileSync(args[1], "utf8"));
  } else if (args[0] === "--shared") {
    const text = readFileSync(args[1], "utf8");
    list = wordsFromShared(text);
    if (!list) {
      const url = findLink(text);
      list = wordsFromHtml(await download(url), url);
    }
  } else {
    const url = findLink(args.join(" "));
    list = wordsFromHtml(await download(url), url);
  }
  process.stdout.write(JSON.stringify(list, null, 2) + "\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
