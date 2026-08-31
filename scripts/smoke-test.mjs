// Headless smoke test for the page's embedded script.
// Extracts the inline script + the embedded JSON from index.html, runs them against a
// DOM stub, then drives the real handlers with a stubbed fetch, Image and <script> loader.
import fs from "node:fs";
import assert from "node:assert/strict";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

const dataMatch = html.match(/<script id="sandbox-data" type="application\/json">([\s\S]*?)<\/script>/);
assert.ok(dataMatch, "sandbox-data block missing");
const sandboxJson = dataMatch[1];

const scripts = [...html.matchAll(/<script(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g)];
assert.equal(scripts.length, 1, `expected 1 inline JS block, found ${scripts.length}`);
const js = scripts[0][1];

// --- DOM stub ---------------------------------------------------------------
const registry = {};
const handlers = {};
const appendedScripts = [];

function makeEl(id) {
  const node = {
    id, _html: "", children: [], value: "", disabled: false, textContent: "",
    // A real <select> always has a selectedIndex; without this the page reads
    // options[undefined] and silently loses the hint text.
    selectedIndex: 0,
    style: { setProperty() {}, display: "" }, dataset: {}, href: "", download: "",
    set className(v) { this._cls = v; }, get className() { return this._cls; },
    set innerHTML(v) { this._html = String(v); this.children.length = 0; },
    get innerHTML() { return this._html; },
    appendChild(c) { this.children.push(c); return c; },
    remove() { this._removed = true; },
    addEventListener(t, fn) { handlers[id + ":" + t] = fn; },
    setAttribute(k, v) { (this._attrs ||= {})[k] = v; },
    getAttribute(k) { return (this._attrs || {})[k]; },
  };
  // Defined after the literal so nothing can spread over them.
  Object.defineProperty(node, "removeChild", {
    enumerable: true,
    value(c) {
      const i = this.children.indexOf(c);
      assert.ok(i >= 0, "removeChild called with a node that is not a child");
      this.children.splice(i, 1);
      return c;
    },
  });
  Object.defineProperty(node, "firstChild", { enumerable: true, get() { return this.children[0] || null; } });
  // <select>.options is its option children, which is all this page relies on
  Object.defineProperty(node, "options", {
    enumerable: true,
    get() { return this.children.filter((c) => c.tagName === "option"); },
  });
  return node;
}

// Recursively collects text, because bubbles mix text nodes and element children.
const textOf = (el) => (el.children || []).map((c) => c.textContent || textOf(c) || "").join("\n");

// Elements the page only reads inside a handler were never registered at load time.
const byId = (id) => (registry[id] ||= makeEl(id));

// A real browser parses static markup into children; the stub cannot. Seed the two
// containers whose children are hardcoded in index.html so the page sees them.
function seedStaticOptions(id) {
  const m = html.match(new RegExp(`<select id="${id}"[^>]*>([\\s\\S]*?)<\\/select>`));
  if (!m) return;
  const el = registry[id];
  for (const om of m[1].matchAll(/<option([^>]*)>([\s\S]*?)<\/option>/g)) {
    const attrs = om[1];
    const node = makeEl("option");
    node.tagName = "option";
    const v = /value="([^"]*)"/.exec(attrs);
    node.value = v ? v[1] : om[2].trim();
    node.textContent = om[2].trim();
    node.selected = /selected/.test(attrs);
    el.children.push(node);
  }
  // A real <select> defaults to its selected option, or the first one. Without this
  // the stub reads "" and the page takes the wrong branch for entirely fake reasons.
  if (!el.value) {
    const chosen = el.children.find((c) => c.selected) || el.children[0];
    if (chosen) el.value = chosen.value;
  }
}

function seedStaticButtons(id) {
  const m = html.match(new RegExp(`<div class="tabs" id="${id}"[^>]*>([\\s\\S]*?)<\\/div>`));
  if (!m) return;
  const el = registry[id];
  for (const bm of m[1].matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)) {
    const attrs = bm[1];
    const node = makeEl("button");
    node.tagName = "button";
    node.textContent = bm[2].trim();
    const pane = /data-pane="([^"]*)"/.exec(attrs);
    if (pane) node.dataset.pane = pane[1];
    node.selected = /aria-selected="true"/.test(attrs);
    el.children.push(node);
  }
}

const document = {
  head: { appendChild(s) { appendedScripts.push(s); setTimeout(() => s.onload && s.onload(), 0); return s; } },
  getElementById(id) {
    if (id === "sandbox-data") return { textContent: sandboxJson };
    const el = (registry[id] ||= makeEl(id));
    if (!el._seeded) { el._seeded = true; seedStaticOptions(id); seedStaticButtons(id); }
    return el;
  },
  createTextNode(t) {
    return { nodeType: 3, textContent: String(t), children: [] };
  },
  createElement(tag) {
    const node = { tagName: tag, ...makeEl(tag) };
    node.style = { setProperty() {}, display: "" };
    return node;
  },
};

const location = { protocol: "file:" };
const window = {};

// --- fetch stub -------------------------------------------------------------
const calls = [];
let fetchBehaviour = "ok";
const fetch = async (url, opts) => {
  calls.push({ url, opts });
  if (fetchBehaviour === "429") {
    return { ok: false, status: 429, text: async () => '{"error":"too many requests"}' };
  }
  return {
    ok: true, status: 200,
    text: async () => JSON.stringify({
      choices: [{ message: { role: "assistant", content: "stub reply", reasoning: "stub think" } }],
    }),
  };
};

// --- Image stub -------------------------------------------------------------
const images = [];
const Image = function () {
  const self = { naturalWidth: 1024, naturalHeight: 1024 };
  Object.defineProperty(self, "src", {
    set(v) { self._src = v; images.push(self); setTimeout(() => self.onload && self.onload(), 0); },
    get() { return self._src; },
  });
  return self;
};

new Function("document", "location", "window", "fetch", "Image", js)(
  document, location, window, fetch, Image);

// --- the build must record that nothing is unlimited ------------------------
const sandbox = JSON.parse(sandboxJson);
assert.equal(sandbox.any_unlimited_provider, false, "data claims an unlimited provider");
assert.ok(sandbox.pollinations.anonymous_limit, "no anonymous limit was recorded");
assert.match(sandbox.pollinations.anonymous_limit, /15 ?s/, "the 15 s limit was not captured");
assert.equal(sandbox.pollinations.has_paid_tier, true, "paid tier not recorded");
assert.equal(sandbox.pollinations.free_images_may_be_watermarked, true, "watermark caveat not recorded");
assert.equal(sandbox.puter.requires_visitor_signin, true, "Puter sign-in requirement not recorded");

// --- the page must not overclaim -------------------------------------------
assert.ok(!/no published rate limit/i.test(html), "page still claims there is no rate limit");

// "unlimited" is allowed only in these explicit denials / data flags, never as a promise.
const ALLOWED_UNLIMITED = [
  /"unlimited":\s*false/i,
  /"any_unlimited_provider":\s*false/i,
  /Nothing here is unlimited/i,
  /there is no unlimited free model API/i,
  /Why there is no unlimited/i,
  /what .unlimited. looks like/i,
  /<th>Unlimited\?<\/th>/i,
  /the only truly unmetered route/i,
  /none of them is unlimited/i,
  /Why no unlimited/i,
  /does not call itself unlimited/i,
];
const offenders = [];
for (const m of html.matchAll(/unlimited/gi)) {
  const around = html.slice(Math.max(0, m.index - 70), m.index + 70);
  if (!ALLOWED_UNLIMITED.some((re) => re.test(around))) offenders.push(around.trim());
}
assert.deepEqual(offenders, [], "page mentions 'unlimited' outside an explicit denial");
assert.ok(html.includes("one request every 15 s") || html.includes("One request every 15 s"),
  "the real Pollinations ceiling is not stated on the page");
assert.ok(html.includes("may be watermarked") || html.includes("may carry a watermark"),
  "watermark caveat missing");

// --- removed by request -----------------------------------------------------
assert.ok(!html.includes("openrouter"), "OpenRouter is still referenced");
assert.ok(!html.includes("orkey"), "OpenRouter key field is still present");
assert.ok(!html.includes('id="catalogue"'), "the self-hostable catalogue is still present");
assert.ok(!html.includes("zai-org"), "GLM reappeared");

// --- provider + model pickers ----------------------------------------------
const providerSel = registry["provider"];
assert.equal(providerSel.children.length, 2, "expected poll + puter providers");
assert.deepEqual(
  providerSel.children.map((c) => c.value), ["poll", "puter"],
  "providers are not poll/puter"
);

const modelSel = registry["model"];



assert.equal(modelSel.children.length, sandbox.pollinations.text_models.length,
  "keyless model list not populated");
assert.equal(modelSel.children[0].value, sandbox.pollinations.text_models[0].name);
assert.match(registry["modelHint"].textContent, /no account/, "hint does not say no account is needed");
assert.match(registry["providerHint"].textContent, /15 ?s/, "provider hint omits the rate limit");

handlers["provider:change"] && (providerSel.value = "puter", handlers["provider:change"]());
providerSel.value = "puter";
handlers["provider:change"]();
assert.ok(modelSel.children.length >= 4, "Puter shortlist not offered");
assert.ok(modelSel.children.some((c) => c.value === ""), "no Puter default option");
assert.match(registry["modelHint"].textContent, /Puter meters/, "Puter hint does not mention metering");

// back to keyless for the chat test
providerSel.value = "poll";
handlers["provider:change"]();

// --- tabs -------------------------------------------------------------------
const tabButtons = registry["tabs"].children;
assert.equal(tabButtons.length, 2, `expected 2 tabs, got ${tabButtons.length}`);
assert.deepEqual(tabButtons.map((b) => b.dataset.pane).sort(), ["chat", "image"]);

// --- image generation -------------------------------------------------------
byId("iprompt").value = "a red fox & a <test>";
byId("isize").value = "1024x576";
byId("iseed").value = "42";
handlers["gen:click"]();
assert.equal(images.length, 1, "Generate did not create an <img>");
const src = images[0].src;
assert.ok(src.startsWith("https://image.pollinations.ai/prompt/"), "wrong image host");
assert.ok(src.includes("a%20red%20fox%20%26%20a%20%3Ctest%3E"), "prompt was not URL-encoded");
assert.ok(src.includes("width=1024") && src.includes("height=576"), "size not passed through");
assert.ok(src.includes("seed=42"), "seed not passed through");
assert.equal(calls.length, 0, "image generation should not use fetch");

await new Promise((r) => setTimeout(r, 5));
assert.ok(byId("iout").children.length >= 1, "loaded image was not inserted");
assert.equal(byId("idownload").style.display, "", "download link not revealed");
assert.equal(byId("iopen").href, src, "open-full-size link points elsewhere");
assert.match(textOf(byId("ilog")), /watermark/, "log omits the watermark caveat");

handlers["irand:click"]();
assert.match(byId("iseed").value, /^\d+$/, "random seed did not produce a number");

// --- chat: keyless path -----------------------------------------------------
byId("prompt").value = "hello";
byId("sys").value = "be brief";
await handlers["send:click"]();
const textCall = calls.find((c) => c.url === "https://text.pollinations.ai/openai");
assert.ok(textCall, "chat did not call the keyless endpoint");
assert.equal(textCall.opts.method, "POST");
assert.equal(textCall.opts.headers.Authorization, undefined, "keyless call sent an Authorization header");
const body = JSON.parse(textCall.opts.body);
assert.equal(body.messages[0].role, "system");
assert.equal(body.messages[0].content, "be brief");
assert.equal(body.messages.at(-1).content, "hello");
assert.match(textOf(byId("thread")), /stub reply/, "assistant reply not rendered");
assert.ok(byId("thread").children.some((c) => c._removed), "'thinking' bubble not removed");
assert.equal(byId("send").disabled, false, "Send left disabled");

// --- the anonymous cooldown actually throttles ------------------------------
// The page must refuse to fire a second Pollinations request inside 15 s, which is
// exactly the ceiling the anonymous tier imposes.
const before = calls.filter((c) => c.url === "https://text.pollinations.ai/openai").length;
byId("prompt").value = "again";
const t0 = Date.now();
await handlers["send:click"]();
const waited = Date.now() - t0;
const after = calls.filter((c) => c.url === "https://text.pollinations.ai/openai").length;
assert.equal(after, before + 1, "a request was sent without going through the throttle path");
assert.ok(waited >= 13000, `second request was not throttled (waited only ${waited} ms)`);
assert.match(textOf(byId("clog")), /anonymous tier is one request every 15 ?s/i,
  "the cooldown was not explained to the user");

// --- Puter path loads the SDK rather than faking it -------------------------
await new Promise((r) => setTimeout(r, 15100));   // clear the anonymous cooldown
fetchBehaviour = "ok";
providerSel.value = "puter";
handlers["provider:change"]();
byId("prompt").value = "hi";
await handlers["send:click"]();
assert.equal(appendedScripts.length, 1, "Puter SDK was not loaded when selected");
assert.equal(appendedScripts[0].src, sandbox.puter.sdk, "wrong Puter SDK URL");
assert.match(textOf(byId("thread")), /Puter SDK loaded but exposed no global|Could not load the Puter SDK/,
  "Puter failure was not surfaced honestly");

// --- status line ------------------------------------------------------------
assert.match(registry["counts"].textContent, /keyless text model/, "counts pill missing");
assert.match(registry["statusText"].textContent, /providers reachable/, "status line wrong");
assert.match(registry["anonLimit"].textContent, /15 ?s/, "callout does not state the ceiling");

console.log("PASS  sandbox wired and driven end-to-end");
console.log("      keyless text :", sandbox.pollinations.text_models.map((m) => m.name).join(", "));
console.log("      keyless image:", sandbox.pollinations.image_models.join(", "));
console.log("      anonymous cap:", sandbox.pollinations.anonymous_limit);
console.log("      paid tier    :", sandbox.pollinations.paid_tier_name, "| watermark:", sandbox.pollinations.free_images_may_be_watermarked);
console.log("      puter        :", sandbox.puter.advertised);
