// Runs apps-script/Code.gs against a fake Google Sheet, for the unit tests and the browser test.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const CODE = readFileSync(new URL("../../apps-script/Code.gs", import.meta.url), "utf8");

export function fakeGoogle() {
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
