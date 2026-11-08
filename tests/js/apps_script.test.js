// The Google Apps Script inbox (apps-script/Code.gs), run against a fake Google Sheet.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeGoogle } from "./fake_google.js";

test("adds, lists and acknowledges recipes with the right token", () => {
  const g = fakeGoogle();
  const token = g.ctx.setup();
  assert.match(token, /^0000\d+$/);
  assert.equal(g.ctx.setup(), token); // running setup again keeps the same token

  assert.equal(g.get({ action: "list", token: "wrong" }).error, "bad token");
  assert.equal(g.post({ url: "https://x.example/soup" }).message, "Couldn't send: bad token");

  const a = g.post({ token, url: "https://x.example/soup", title: "Soup" });
  assert.equal(a.ok, true);
  assert.equal(a.message, "Sent to Recipe to Cart");
  // Shared text with words around the link, sent with GET this time.
  const b = g.get({ action: "add", token, url: "Try this! https://y.example/stew?ref=ig." });
  assert.equal(b.ok, true);
  // The same link again while it's still waiting isn't added twice.
  assert.equal(g.post({ token, url: "https://x.example/soup" }).duplicate, true);

  let list = g.get({ action: "list", token }).recipes;
  assert.deepEqual(list.map((r) => [r.url, r.title]), [["https://x.example/soup", "Soup"], ["https://y.example/stew?ref=ig", ""]]);
  assert.match(list[0].added, /^\d{4}-\d\d-\d\dT/);

  assert.equal(g.get({ action: "ack", token, ids: `${a.id},nope` }).acked, 1);
  list = g.get({ action: "list", token }).recipes;
  assert.deepEqual(list.map((r) => r.id), [b.id]);
  assert.equal(g.sheets.Inbox.rows[1][4], "picked up");
});

test("a plain-text POST body is treated as the shared link", () => {
  const g = fakeGoogle();
  const token = g.ctx.setup();
  assert.equal(g.post("https://z.example/pie", { token }).ok, true);
  assert.equal(g.post("no link here", { token }).error, "no link found");
  assert.equal(g.get({ action: "list", token }).recipes[0].url, "https://z.example/pie");
});

test("refuses everything before setup has made a token", () => {
  const g = fakeGoogle();
  assert.equal(g.get({ action: "list", token: "" }).error, "bad token");
});

test("search words: the extension asks, the task answers, the extension reads them", () => {
  const g = fakeGoogle();
  const token = g.ctx.setup();
  const words = [
    { key: "cut up fryer chicken", name: "Cut Up Fryer Chicken", guess: "whole chicken cut up" },
    { key: "ditalini pasta", name: "Ditalini Pasta", guess: "ditalini pasta" },
  ];
  // A POST body arrives parsed; asking twice doesn't add the same ingredient again.
  assert.deepEqual(g.post({ action: "ask", token, words }), { ok: true, added: 2, message: "Sent to Recipe to Cart" });
  assert.equal(g.post({ action: "ask", token, words }).added, 0);
  // A GET sends the list as JSON text. Leading = can't sneak a formula into the sheet.
  assert.equal(g.get({ action: "ask", token, words: JSON.stringify([{ key: "Lemon", name: "=HYPERLINK(1)", guess: "lemon" }]) }).added, 1);
  assert.deepEqual(g.sheets["Search words"].rows[3], ["lemon", "HYPERLINK(1)", "lemon", "", ""]);

  assert.deepEqual(g.get({ action: "pending", token }).words.map((w) => w.key), ["cut up fryer chicken", "ditalini pasta", "lemon"]);
  assert.deepEqual(g.get({ action: "words", token }).words, {});

  const answer = g.post({ action: "answer", token, words: { "ditalini pasta": "barilla ditalini pasta", nope: "x", lemon: "  " } });
  assert.equal(answer.answered, 1);
  assert.deepEqual(g.get({ action: "words", token }).words, { "ditalini pasta": "barilla ditalini pasta" });
  assert.deepEqual(g.get({ action: "pending", token }).words.map((w) => w.key), ["cut up fryer chicken", "lemon"]);

  assert.equal(g.get({ action: "words", token: "wrong" }).error, "bad token");
  assert.equal(g.post({ action: "ask", token, words: { not: "a list" } }).ok, false);
  assert.equal(g.get({ action: "answer", token, words: "not json" }).ok, false);
  assert.equal(g.sheets.Inbox.rows.length, 1, "the recipe inbox tab is left alone");
});

test("instant pickup: each new recipe pings the private channel the extension set", () => {
  const g = fakeGoogle();
  const token = g.ctx.setup();
  g.post({ token, url: "https://x.example/soup" });
  assert.equal(g.fetched.length, 0, "no channel set, no ping");

  assert.equal(g.post({ action: "push", token, topic: "short" }).error, "bad topic");
  assert.equal(g.post({ action: "push", token, topic: "rtc-abc/../../x" }).error, "bad topic");
  assert.equal(g.post({ action: "push", token: "wrong", topic: "rtc-abcdefghijkmnpqrstu" }).error, "bad token");
  assert.equal(g.post({ action: "push", token, topic: "rtc-abcdefghijkmnpqrstu" }).push, true);

  g.post({ token, url: "https://x.example/stew" });
  assert.deepEqual(g.fetched.map((f) => [f.url, f.method, f.payload]), [["https://ntfy.sh/rtc-abcdefghijkmnpqrstu", "post", "new recipe"]]);
  g.post({ token, url: "https://x.example/stew" }); // already waiting: no second ping
  assert.equal(g.fetched.length, 1);

  assert.equal(g.get({ action: "push", token, topic: "" }).push, false);
  g.post({ token, url: "https://x.example/pie" });
  assert.equal(g.fetched.length, 1, "turned off");
});
