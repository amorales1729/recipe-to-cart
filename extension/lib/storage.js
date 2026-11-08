// Everything the extension remembers lives in Chrome's own storage on this computer.

const area = () => chrome.storage.local;

async function get(key, fallback) {
  const out = await area().get(key);
  return out[key] ?? fallback;
}
const set = (key, value) => area().set({ [key]: value });

export async function recipes() {
  return get("recipes", []);
}

/** Save a recipe. The same page saved again replaces the old copy and keeps its id. */
export async function saveRecipe(recipe) {
  const all = await recipes();
  const existing = recipe.url ? all.find((r) => r.url === recipe.url) : null;
  const saved = { ...recipe, id: existing ? existing.id : `r${Date.now()}`, savedAt: new Date().toISOString() };
  await set("recipes", existing ? all.map((r) => (r.id === existing.id ? saved : r)) : [saved, ...all]);
  return saved;
}

export async function deleteRecipe(id) {
  await set("recipes", (await recipes()).filter((r) => r.id !== id));
}

export async function searchTerms() {
  return get("searchTerms", {});
}

export async function saveSearchTerm(key, query) {
  await set("searchTerms", { ...(await searchTerms()), [key]: query.trim() });
}

/** Walmart searches suggested by the scheduled task, from the inbox's "Search words" tab: {key: search}. */
export async function suggestedWords() {
  return get("suggestedWords", {});
}

export async function saveSuggestedWords(words) {
  await set("suggestedWords", words);
}

/** Ingredients already sent to the inbox for a suggested search. */
export async function askedWords() {
  return new Set(await get("askedWords", []));
}

export async function markAsked(keys) {
  await set("askedWords", [...new Set([...(await askedWords()), ...keys])]);
}

/** Last time's product per ingredient: {key: {id, name, url}}. */
export async function choices() {
  return get("choices", {});
}

export async function saveChoices(picks) {
  await set("choices", { ...(await choices()), ...picks });
}
