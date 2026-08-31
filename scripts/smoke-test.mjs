// Headless smoke test for the page's embedded script.
// Extracts <script> (non-JSON) + <script id="model-data"> from index.html,
// runs them against a minimal DOM stub, and asserts on what the page would render.
import fs from "node:fs";
import assert from "node:assert/strict";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

// --- pull the two script blocks out of the built page ---
const dataMatch = html.match(/<script id="model-data" type="application\/json">([\s\S]*?)<\/script>/);
assert.ok(dataMatch, "model-data script block missing");

const scripts = [...html.matchAll(/<script(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g)];
assert.equal(scripts.length, 1, `expected 1 inline JS block, found ${scripts.length}`);
const js = scripts[0][1];

// --- minimal DOM stub ---
function el(id) {
  return {
    id, _html: "", style: { setProperty() {} }, children: [],
    set className(v) { this._cls = v; }, get className() { return this._cls; },
    set textContent(v) { this._text = String(v); }, get textContent() { return this._text; },
    set innerHTML(v) { this._html = String(v); }, get innerHTML() { return this._html; },
    insertAdjacentHTML(_pos, frag) { this._html += frag; },
    appendChild(child) { this.children.push(child); return child; },
    click() { if (typeof this.onclick === "function") this.onclick(); },
    setAttribute(k, v) { (this._attrs ||= {})[k] = v; },
    getAttribute(k) { return (this._attrs || {})[k]; },
  };
}

const registry = {};
// The page hands this text straight to JSON.parse, exactly as the browser would.
// The \/ that build_site.py inserted is a legal JS string escape, so no unescaping here.
const rawJson = dataMatch[1];
const document = {
  getElementById(id) {
    if (id === "model-data") return { textContent: rawJson };
    return (registry[id] ||= el(id));
  },
  querySelector(sel) {
    assert.equal(sel, "#benchTable tbody", "unexpected selector " + sel);
    return (registry["benchTableTbody"] ||= el("benchTableTbody"));
  },
  createElement(tag) { return { tagName: tag, ...el(tag), style: { setProperty() {} } }; },
};

const location = { protocol: "file:" };
let fetchCalls = 0;
const fetch = () => { fetchCalls++; return Promise.reject(new Error("offline")); };

// --- run the page script ---
new Function("document", "location", "fetch", js)(document, location, fetch);

// --- assertions ---
const grid = registry["grid"];
assert.equal(grid.children.length, 3, `expected 3 model cards, got ${grid.children.length}`);
const gridHtml = grid.children.map((c) => c.innerHTML).join("\n");
for (const repo of ["zai-org/GLM-5.3", "microsoft/TRELLIS.2-4B", "microsoft/TRELLIS-text-xlarge"]) {
  assert.ok(gridHtml.includes(repo), `grid missing ${repo}`);
}
assert.ok(gridHtml.includes("753B"), "GLM-5.3 parameter count not rendered as 753B");
assert.ok(gridHtml.includes("1,738,794"), "TRELLIS.2 downloads not formatted");
assert.ok(gridHtml.includes("image-to-3d"), "pipeline tag missing");
assert.ok(gridHtml.includes("microsoft/TRELLIS-text-xlarge") && gridHtml.includes("Text-to-3D generator"),
  "TRELLIS-text-xlarge card incomplete");
assert.equal((gridHtml.match(/View on the Hub/g) || []).length, 3, "not every card links back to the Hub");

const rows = (registry["benchTableTbody"].innerHTML.match(/<tr>/g) || []).length;
assert.equal(rows, 16, `expected 16 benchmark rows, got ${rows}`);
assert.ok(registry["benchTableTbody"].innerHTML.includes("CyberGym"), "CyberGym row missing");
assert.ok(registry["benchTableTbody"].innerHTML.includes('class="best"'), "no best-in-row highlight");
assert.ok(registry["benchTableTbody"].innerHTML.includes('class="hi"'), "no GLM column highlight");

assert.equal(registry["reader"].children.length, 3, "expected 3 model-card tabs");
assert.equal(registry["reader"].children[0].getAttribute("aria-selected"), "true", "first tab not selected");

const tryGrid = registry["tryGrid"];
assert.equal(tryGrid.children.length, 3, `expected 3 free-access cards, got ${tryGrid.children.length}`);
const tryHtml = tryGrid.children.map((c) => c.innerHTML).join("\n");
for (const href of [
  "https://huggingface.co/spaces/microsoft/TRELLIS.2",
  "https://z.ai",
  "https://openrouter.ai/z-ai/glm-5.2:free",
]) {
  assert.ok(tryHtml.includes(href), `free-access card missing ${href}`);
}
assert.ok(tryHtml.includes("50 req/day"), "free tier limits not disclosed on the card");
assert.ok(tryHtml.includes("GLM-5.3-Flash"), "z.ai entry does not name the model actually served");
const card = registry["cardBody"].innerHTML;
assert.ok(card.includes("<table>"), "model card markdown table did not render");
assert.ok(card.includes("<pre><code"), "model card code fence did not render");
assert.ok(card.includes("GLM-5.3"), "GLM card content missing");
assert.ok(!card.includes("__MODELS_JSON__"), "unrendered placeholder leaked into the page");
assert.ok(!/<script/i.test(card), "markdown renderer emitted a raw <script> tag — XSS risk");

assert.match(registry["statusText"].textContent, /all 3 models fetched/, "status line wrong");
assert.match(registry["genAt"].textContent, /^built 20\d\d-/, "generated-at stamp wrong");
assert.match(registry["footRev"].textContent, /GLM-5\.3@[0-9a-f]{7}/, "footer revision wrong");
assert.equal(fetchCalls, 0, "file:// mode should not attempt a live refresh");

console.log("PASS  3 cards · 16 benchmark rows · 3 tabs · status:", registry["statusText"].textContent);
console.log("      footer:", registry["footRev"].textContent);
console.log("      GLM card render length:", card.length, "chars");
