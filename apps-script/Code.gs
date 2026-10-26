/**
 * Recipe to Cart inbox: a free mailbox in your Google account.
 *
 * Your iPhone shortcut drops recipe links here. The Chrome extension on your PC picks
 * them up the next time Chrome is open. Runs on Google Apps Script, which is free for
 * personal use, and stores links in the Google Sheet this script is attached to.
 *
 * Setup: see docs/iphone-shortcut.md. In short: paste this file into Extensions >
 * Apps Script of a new Google Sheet, run setup() once, then Deploy > New deployment >
 * Web app (Execute as: Me, Who has access: Anyone).
 *
 * Requests (GET query parameters or a POST JSON body), all need token=<your token>:
 *   action=add   url=<recipe link or shared text containing one>  title=<optional>
 *   action=list  -> waiting recipes
 *   action=ack   ids=<comma-separated ids>  -> marks them picked up
 *
 * Walmart search words, on the "Search words" tab. The extension sends ingredients it hasn't
 * seen, a scheduled task suggests a better Walmart search for each, and the extension
 * uses them from then on. You can edit the "walmart search" column yourself too.
 *   action=ask      words=<JSON list of {key, name, guess}>  -> adds the ones not on the tab yet
 *   action=pending  -> ingredients still waiting for a search
 *   action=answer   words=<JSON object {key: search}>  -> fills in searches
 *   action=words    -> every ingredient that has a search, as {key: search}
 */

var SHEET_NAME = "Inbox";
var HEADERS = ["id", "added", "url", "title", "status", "picked up"];
var MAX_LIST = 50;
var WORDS_SHEET = "Search words";
var WORDS_HEADERS = ["ingredient", "as written", "rules search", "walmart search", "updated"];
var MAX_WORDS = 200;

// Run once from the Apps Script editor. Creates the sheet and your secret token.
function setup() {
  sheet_();
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty("TOKEN");
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, "");
    props.setProperty("TOKEN", token);
  }
  Logger.log("Your Recipe to Cart token: " + token);
  return token;
}

function doGet(e) {
  return handle_((e && e.parameter) || {});
}

function doPost(e) {
  var params = {};
  var p = (e && e.parameter) || {};
  for (var k in p) params[k] = p[k];
  if (e && e.postData && e.postData.contents) {
    try {
      var body = JSON.parse(e.postData.contents);
      for (var b in body) params[b] = body[b];
    } catch (err) {
      // Not JSON: treat the body as shared text.
      if (!params.url) params.url = e.postData.contents;
    }
  }
  if (!params.action) params.action = "add";
  return handle_(params);
}

function handle_(params) {
  var token = PropertiesService.getScriptProperties().getProperty("TOKEN");
  if (!token || String(params.token || "") !== token) {
    return json_({ ok: false, error: "bad token" });
  }
  var action = String(params.action || "list");
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (action === "add") return json_(add_(params));
    if (action === "list") return json_({ ok: true, recipes: list_() });
    if (action === "ack") return json_(ack_(String(params.ids || "").split(",")));
    if (action === "ask") return json_(ask_(parseJson_(params.words, null)));
    if (action === "pending") return json_({ ok: true, words: pending_() });
    if (action === "answer") return json_(answer_(parseJson_(params.words, null)));
    if (action === "words") return json_({ ok: true, words: words_() });
    return json_({ ok: false, error: "unknown action" });
  } finally {
    lock.releaseLock();
  }
}

function add_(params) {
  var url = findUrl_(String(params.url || ""));
  if (!url) return { ok: false, error: "no link found" };
  var title = String(params.title || "").slice(0, 300);
  var sheet = sheet_();
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][2]) === url && rows[i][4] === "waiting") return { ok: true, id: String(rows[i][0]), duplicate: true };
  }
  var id = Utilities.getUuid();
  sheet.appendRow([id, new Date(), url, title, "waiting", ""]);
  return { ok: true, id: id };
}

function list_() {
  var rows = sheet_().getDataRange().getValues();
  var out = [];
  for (var i = 1; i < rows.length && out.length < MAX_LIST; i++) {
    if (rows[i][4] !== "waiting") continue;
    var added = rows[i][1] instanceof Date ? rows[i][1].toISOString() : String(rows[i][1]);
    out.push({ id: String(rows[i][0]), added: added, url: String(rows[i][2]), title: String(rows[i][3]) });
  }
  return out;
}

function ack_(ids) {
  var wanted = {};
  ids.forEach(function (id) { if (id) wanted[id] = true; });
  var sheet = sheet_();
  var rows = sheet.getDataRange().getValues();
  var now = new Date();
  var done = 0;
  for (var i = 1; i < rows.length; i++) {
    if (wanted[String(rows[i][0])] && rows[i][4] === "waiting") {
      sheet.getRange(i + 1, 5, 1, 2).setValues([["picked up", now]]);
      done++;
    }
  }
  return { ok: true, acked: done };
}

// ---- Walmart search words ----

function ask_(list) {
  if (!Array.isArray(list)) return { ok: false, error: "words should be a list" };
  var sheet = wordsSheet_();
  var rows = sheet.getDataRange().getValues();
  var known = {};
  for (var i = 1; i < rows.length; i++) known[String(rows[i][0])] = true;
  var added = 0;
  list.slice(0, MAX_WORDS).forEach(function (w) {
    var key = clean_(w && w.key, 100).toLowerCase();
    if (!key || known[key]) return;
    known[key] = true;
    sheet.appendRow([key, clean_(w.name, 200), clean_(w.guess, 200), "", ""]);
    added++;
  });
  return { ok: true, added: added };
}

function pending_() {
  var rows = wordsSheet_().getDataRange().getValues();
  var out = [];
  for (var i = 1; i < rows.length && out.length < MAX_WORDS; i++) {
    if (rows[i][0] && !String(rows[i][3]).trim()) out.push({ key: String(rows[i][0]), name: String(rows[i][1]), guess: String(rows[i][2]) });
  }
  return out;
}

function answer_(words) {
  if (!words || typeof words !== "object" || Array.isArray(words)) return { ok: false, error: "words should be {ingredient: search}" };
  var sheet = wordsSheet_();
  var rows = sheet.getDataRange().getValues();
  var now = new Date();
  var done = 0;
  for (var i = 1; i < rows.length; i++) {
    var search = clean_(words[String(rows[i][0])], 100);
    if (search) {
      sheet.getRange(i + 1, 4, 1, 2).setValues([[search, now]]);
      done++;
    }
  }
  return { ok: true, answered: done };
}

function words_() {
  var rows = wordsSheet_().getDataRange().getValues();
  var out = {};
  for (var i = 1; i < rows.length; i++) {
    var search = String(rows[i][3]).trim();
    if (rows[i][0] && search) out[String(rows[i][0])] = search;
  }
  return out;
}

function wordsSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(WORDS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(WORDS_SHEET);
    sheet.appendRow(WORDS_HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Lists and objects arrive as JSON text in a GET, or already parsed in a POST body.
function parseJson_(value, fallback) {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(String(value || ""));
  } catch (err) {
    return fallback;
  }
}

function clean_(value, max) {
  // A leading = + - @ would turn the cell into a formula.
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().replace(/^[=+\-@]+/, "").slice(0, max);
}

// Shared text from some apps wraps the link in words ("Check out this recipe! https://...").
function findUrl_(text) {
  var m = text.match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0].replace(/[).,!?]+$/, "") : "";
}

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// "message" is what the iPhone shortcut shows in its notification.
function json_(obj) {
  if (!obj.message) obj.message = obj.ok ? (obj.duplicate ? "Already waiting in Recipe to Cart" : "Sent to Recipe to Cart") : "Couldn't send: " + obj.error;
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
