// Headless smoke test for the page's embedded script.
// Extracts <script> (non-JSON) + <script id="model-data"> from index.html,
// runs them against a minimal DOM stub, asserts on the rendered output, and then
// actually invokes the event handlers to check the generator behaves.
import fs from "node:fs";
import assert from "node:assert/strict";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

const dataMatch = html.match(/<script id="model-data" type="application\/json">([\s\S]*?)<\/script>/);
assert.ok(dataMatch, "model-data script block missing");

const scripts = [...html.matchAll(/<script(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g)];
assert.equal(scripts.length, 1, `expected 1 inline JS block, found ${scripts.length}`);
const js = scripts[0][1];

// --- minimal DOM stub -------------------------------------------------------
const registry = {};
const handlers = {};   // "id:type" -> listener

function makeEl(id) {
  return {
    id, _html: "", children: [], value: "", disabled: false, files: [],
    style: { setProperty() {} },
    set className(v) { this._cls = v; }, get className() { return this._cls; },
    set textContent(v) { this._text = String(v); }, get textContent() { return this._text ?? ""; },
    set innerHTML(v) { this._html = String(v); }, get innerHTML() { return this._html; },
    insertAdjacentHTML(_p, frag) { this._html += frag; },
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(type, fn) { handlers[id + ":" + type] = fn; },
    click() { if (typeof this.onclick === "function") this.onclick(); },
    setAttribute(k, v) { (this._attrs ||= {})[k] = v; },
    getAttribute(k) { return (this._attrs || {})[k]; },
  };
}

const rawJson = dataMatch[1];
const document = {
  getElementById(id) {
    if (id === "model-data") return { textContent: rawJson };
    return (registry[id] ||= makeEl(id));
  },
  createElement(tag) { return { tagName: tag, ...makeEl(tag), style: { setProperty() {} } }; },
};

// browser globals the page touches at load time
const location = { protocol: "file:" };
const localStorage = { _s: {}, getItem(k) { return this._s[k] ?? null; }, setItem(k, v) { this._s[k] = String(v); } };
const urlStub = { createObjectURL: () => "blob:stub" };
let fetchCalls = 0;
const fetch = () => { fetchCalls++; return Promise.reject(new Error("offline")); };
const FormData = function () { this.append = () => {}; };

new Function("document", "location", "localStorage", "URL", "fetch", "FormData", js)(
  document, location, localStorage, urlStub, fetch, FormData);

// --- model cards ------------------------------------------------------------
const grid = registry["grid"];
assert.equal(grid.children.length, 2, `expected 2 model cards, got ${grid.children.length}`);
const gridHtml = grid.children.map((c) => c.innerHTML).join("\n");
for (const repo of ["microsoft/TRELLIS.2-4B", "microsoft/TRELLIS-text-xlarge"]) {
  assert.ok(gridHtml.includes(repo), `grid missing ${repo}`);
}
assert.ok(gridHtml.includes("image-to-3d"), "TRELLIS.2 task tag missing");
assert.ok(gridHtml.includes("text-to-3d"), "TRELLIS-text task tag missing");
assert.ok(gridHtml.includes("1,738,794"), "TRELLIS.2 downloads not formatted");
assert.equal((gridHtml.match(/View on the Hub/g) || []).length, 2, "not every card links back to the Hub");

// --- GLM must be gone -------------------------------------------------------
const rendered = gridHtml + registry["cardBody"].innerHTML;
for (const gone of ["GLM-5.3", "zai-org", "CyberGym", "Terminal Bench", "glm-5.2:free", "z.ai"]) {
  assert.ok(!rendered.includes(gone), `GLM reference still rendered: ${gone}`);
}
assert.ok(!html.includes("zai-org"), "GLM still referenced in the built page source");
assert.ok(!/Terminal Bench/.test(html), "GLM benchmark table still in the built page");

assert.equal(registry["reader"].children.length, 2, "expected 2 model-card tabs");
assert.equal(registry["reader"].children[0].getAttribute("aria-selected"), "true", "first tab not selected");

const card = registry["cardBody"].innerHTML;
assert.ok(card.includes("<table>"), "model card markdown table did not render");
assert.ok(card.includes("<pre><code"), "model card code fence did not render");
assert.ok(card.includes("TRELLIS.2"), "TRELLIS card content missing");
assert.ok(!card.includes("__MODELS_JSON__"), "unrendered placeholder leaked into the page");
assert.ok(!/<script/i.test(card), "markdown renderer emitted a raw <script> tag — XSS risk");

// --- generator: handlers must be bound -------------------------------------
for (const key of ["drop:click", "drop:drop", "imgInput:change", "token:change", "go:click"]) {
  assert.equal(typeof handlers[key], "function", `handler ${key} was not registered`);
}
for (const id of ["res", "seed"]) {
  assert.ok(js.includes('getElementById("' + id + '")'), `handler never reads #${id}`);
}

// the client must target the Space's real Gradio prefix, not the old /call/ one
assert.ok(js.includes("/gradio_api"), "client does not use the /gradio_api prefix");
assert.ok(js.includes("microsoft-trellis-2.hf.space"), "Space runtime host missing from the client");
for (const ep of ["start_session", "image_to_3d", "end_session", "/upload"]) {
  assert.ok(js.includes(ep), `client never calls ${ep}`);
}

// the quota reality must be stated on the page, not hidden
assert.ok(html.includes("not unlimited"), "page does not disclose that access is not unlimited");
assert.ok(html.includes("120 s"), "page does not state the 120 s per-call reservation");
assert.ok(html.includes("ZeroGPU"), "page does not name ZeroGPU as the limiter");
assert.ok(/2 minutes/.test(html) && /5 minutes/.test(html) && /40 minutes/.test(html),
  "page does not list the actual per-tier daily quotas");

// --- exercise the handlers --------------------------------------------------
const logText = () => registry["log"].children.map((c) => c.textContent).join("\n");

// clicking Generate with no image must warn, and must not touch the network
let net = fetchCalls;
await handlers["go:click"]();
assert.ok(/Pick an image first/.test(logText()), "no-image click did not warn the user");
assert.equal(fetchCalls, net, "no-image click hit the network");

// token persistence must write through
registry["token"].value = "hf_test_value";
handlers["token:change"]();
assert.equal(localStorage.getItem("trellis-shelf-hf-token"), "hf_test_value",
  "token was not persisted to localStorage");

// selecting an image must preview it in the drop zone
registry["imgInput"].files = [{ name: "shot.png", size: 20480, type: "image/png" }];
handlers["imgInput:change"]();
assert.ok(registry["drop"].innerHTML.includes("blob:stub"), "selected image was not previewed");
assert.ok(registry["drop"].innerHTML.includes("shot.png"), "selected filename not shown");
assert.equal(fetchCalls, net, "choosing a file hit the network");

// a non-image must be rejected
registry["imgInput"].files = [{ name: "notes.txt", size: 10, type: "text/plain" }];
handlers["imgInput:change"]();
assert.ok(/not an image/.test(logText()), "non-image file was not rejected");

// with an image selected, Generate must reach for the upload endpoint and then
// report the failure honestly rather than silently doing nothing
registry["imgInput"].files = [{ name: "shot.png", size: 20480, type: "image/png" }];
handlers["imgInput:change"]();
registry["log"].innerHTML = ""; registry["log"].children.length = 0;
await handlers["go:click"]();
assert.ok(fetchCalls > net, "Generate with an image did not attempt the upload");
assert.ok(/Failed:|upload failed/.test(logText()), "network failure was not surfaced to the user");
assert.equal(registry["go"].disabled, false, "Generate button left disabled after a failure");

// --- status line ------------------------------------------------------------
assert.match(registry["statusText"].textContent, /all 2 models fetched/, "status line wrong");
assert.match(registry["genAt"].textContent, /^built 20\d\d-/, "generated-at stamp wrong");
assert.match(registry["footRev"].textContent, /TRELLIS\.2-4B@[0-9a-f]{7}/, "footer revision wrong");

console.log("PASS  2 model cards · 2 tabs · generator wired and exercised");
console.log("      status:", registry["statusText"].textContent);
console.log("      footer:", registry["footRev"].textContent);
console.log("      GLM removed:", !rendered.includes("GLM"), "· card render:", card.length, "chars");
