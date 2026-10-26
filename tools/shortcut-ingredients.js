// Paste into the iPhone shortcut's "Run JavaScript on Web Page" action. It returns the page link
// plus the recipe's ingredient lines, which recipe-words.js --shared reads.
var lines = [];
function walk(n) {
  if (!n || lines.length) return;
  if (Array.isArray(n)) { n.forEach(walk); return; }
  if (typeof n !== "object") return;
  var t = [].concat(n["@type"] || []);
  if (t.indexOf("Recipe") >= 0 && n.recipeIngredient) { lines = [].concat(n.recipeIngredient); return; }
  walk(n["@graph"]);
}
document.querySelectorAll('script[type="application/ld+json"]').forEach(function (s) {
  try { walk(JSON.parse(s.textContent)); } catch (e) {}
});
completion(location.href + (lines.length ? "\n\nIngredients\n" + lines.join("\n") : ""));
