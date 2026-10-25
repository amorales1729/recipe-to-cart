// The Google Apps Script inbox (apps-script/Code.gs), run against a fake Google Sheet.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const CODE = readFileSync(new URL("../../apps-script/Code.gs", import.meta.url), "utf8");

function fakeGoogle() {
  const props = {};
  let uuid = 0;
  const sheets = {};
  const makeSheet = () => {
    const rows = [];
    return {
      rows,
      appendRow: (r) => rows.push([...r]),
      setFrozenRows: () => {},
      getDataRange: () => ({ getValues: () => rows.map((r) => [...r]) }),
      getRange: (row, col, _n, width) => ({
        setValues: ([vals]) => { for (let i = 0; i < width; i++) rows[row - 1][col - 1 + i] = vals[i]; },
      }),
    };
  };
  const ctx = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (n) => sheets[n] || null,
        insertSheet: (n) => (sheets[n] = makeSheet()),
      }),
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    Utilities: { getUuid: () => `0000-${++uuid}` },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: (text) => ({ text, setMimeType() { return this; } }),
    },
    Logger: { log() {} },
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  const out = (res) => JSON.parse(res.text);
  return {
    ctx,
    sheets,
    get: (parameter) => out(ctx.doGet({ parameter })),
    post: (body, parameter = {}) => out(ctx.doPost({ parameter, postData: { contents: typeof body === "string" ? body : JSON.stringify(body) } })),
  };
}

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
