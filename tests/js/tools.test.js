import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { wordsFromHtml, wordsFromShared } from "../../tools/recipe-words.js";
import { fixture } from "./helpers.js";

test("a recipe page becomes the same list the extension sends to the Search words tab", () => {
  const words = wordsFromHtml(fixture("italian_chicken_soup.html"), "https://example.com/soup");
  assert.equal(words.length, 11); // no salt, pepper or olive oil
  assert.deepEqual(words[1], { key: "cut up fryer chicken", name: "Cut Up Fryer Chicken", guess: "whole chicken cut up" });
  assert.ok(!words.some((w) => ["salt", "freshly ground pepper", "olive oil", "extra virgin olive oil"].includes(w.key)));
});

test("the command line reads a saved page and refuses text without a link", () => {
  const script = fileURLToPath(new URL("../../tools/recipe-words.js", import.meta.url));
  const page = fileURLToPath(new URL("../fixtures/italian_chicken_soup.html", import.meta.url));
  assert.equal(JSON.parse(execFileSync("node", [script, "--file", page], { encoding: "utf8" })).length, 11);
  assert.throws(() => execFileSync("node", [script, "no link here"], { stdio: "pipe" }), /No link found/);
});

test("an ingredient list sent from the phone gives the same list as the page itself", () => {
  const html = fixture("italian_chicken_soup.html");
  const lines = JSON.parse(html.match(/"recipeIngredient": (\[.*?\])/)[1]);
  const shared = `https://example.com/soup\n\nItalian Chicken Soup\n\nIngredients\n${lines.join("\n")}`;
  assert.deepEqual(wordsFromShared(shared), wordsFromHtml(html, "https://example.com/soup"));
  assert.equal(wordsFromShared("Try this https://example.com/soup"), null);
});
