/**
 * DOM tests for solar-bank-card, run under jsdom so they need no browser and
 * no Home Assistant:
 *
 *   npm install --no-save jsdom && node tests/card.test.mjs
 *
 * They drive the real class the way HA does - setConfig(), then assign hass -
 * and assert on the rendered DOM.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "solar-bank-card.js"), "utf8");

const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
const { window } = dom;
window.console.info = () => {};
for (const k of ["HTMLElement", "document", "customElements", "CustomEvent", "Element"]) {
  globalThis[k] = window[k];
}
globalThis.window = window;
window.eval(src);
const Card = window.customElements.get("solar-bank-card");

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}\n      ${e.message}`);
    process.exitCode = 1;
  }
};

/** Build a card from watt values; null means an unavailable entity. */
function render(banks, config = {}) {
  const states = {};
  const cfgBanks = banks.map((b, bi) => ({
    name: b.name,
    entities: b.values.map((w, i) => {
      const id = `sensor.b${bi}_${i}`;
      if (w !== null) {
        states[id] = {
          state: String(w),
          attributes: { unit_of_measurement: b.unit || "W", friendly_name: `Panel ${bi}.${i}` },
        };
      }
      return id;
    }),
  }));
  const el = window.document.createElement("solar-bank-card");
  el.setConfig({ banks: cfgBanks, ...config });
  window.document.body.appendChild(el);
  el.hass = { states };
  return el;
}

const q = (el, sel) => [...el.querySelectorAll(sel)];
const text = (el, sel) => q(el, sel).map((n) => n.textContent);

console.log("labels");

test("a value label is centred in every cell by default", () => {
  const el = render([{ name: "W", values: [265, 104] }]);
  const vals = q(el, ".cell .val");
  assert.equal(vals.length, 2);
  const css = el.querySelector("style").textContent;
  const rule = css.match(/\.val \{[^}]*\}/)[0];
  assert.match(rule, /align-items: center/);
  assert.match(rule, /justify-content: center/);
  assert.match(rule, /position: absolute; inset: 0/);
});

test("labels show bare watts, honouring w_decimals", () => {
  assert.deepEqual(text(render([{ name: "W", values: [265, 96] }]), ".val"), ["265", "96"]);
  assert.deepEqual(
    text(render([{ name: "W", values: [265.44] }], { w_decimals: 1 }), ".val"),
    ["265.4"]
  );
});

test("show_values: false omits the labels entirely", () => {
  const el = render([{ name: "W", values: [265] }], { show_values: false });
  assert.equal(q(el, ".val").length, 0);
  assert.equal(q(el, ".cell").length, 1);
});

test("an unavailable panel labels as an em dash, not NaN", () => {
  const el = render([{ name: "W", values: [265, null] }]);
  assert.deepEqual(text(el, ".val"), ["265", "—"]);
  assert.equal(q(el, ".cell.dead").length, 1);
});

console.log("contrast");

test("cells at or above half output flip to the on-accent colour", () => {
  // max_value 300 -> 150 W is exactly half.
  const el = render([{ name: "W", values: [149, 150, 299, 10] }]);
  const hot = q(el, ".cell").map((c) => c.classList.contains("hot"));
  assert.deepEqual(hot, [false, true, true, false]);
});

test("an unavailable cell is never marked hot", () => {
  const el = render([{ name: "W", values: [null] }]);
  assert.equal(q(el, ".cell.hot").length, 0);
});

console.log("totals");

test("bank total and count reflect the panels", () => {
  const el = render([{ name: "W", values: [265, 278, 0] }]);
  assert.equal(el.querySelector(".bank-total").textContent, "543 W");
  assert.equal(el.querySelector(".bank-count").textContent, "2/3 producing");
});

test("totals cross into kW at the threshold", () => {
  assert.equal(
    render([{ name: "W", values: [500, 500] }]).querySelector(".bank-total").textContent,
    "1.0 kW"
  );
  assert.equal(
    render([{ name: "W", values: [500, 499] }]).querySelector(".bank-total").textContent,
    "999 W"
  );
});

test("kW-unit sensors are scaled into watts before summing", () => {
  const el = render([{ name: "W", values: [1.5], unit: "kW" }]);
  assert.equal(el.querySelector(".bank-total").textContent, "1.5 kW");
  assert.equal(el.querySelector(".val").textContent, "1500");
});

test("offline panels are called out in the count", () => {
  const el = render([{ name: "W", values: [265, null, null] }]);
  assert.equal(el.querySelector(".bank-count").textContent, "1/3 producing · 2 offline");
});

console.log("layout");

test("every bank uses the widest bank's column count", () => {
  const el = render([
    { name: "W", values: [1, 2, 3, 4, 5] },
    { name: "E", values: [1, 2] },
  ]);
  const cols = q(el, ".grid").map((g) => g.style.gridTemplateColumns);
  assert.deepEqual(cols, ["repeat(5, minmax(0, 1fr))", "repeat(5, minmax(0, 1fr))"]);
});

test("a bad config is rejected rather than rendered", () => {
  const el = window.document.createElement("solar-bank-card");
  assert.throws(() => el.setConfig({}), /banks/);
  assert.throws(() => el.setConfig({ banks: [{ name: "x" }] }), /entities/);
  assert.throws(() => el.setConfig({ banks: [{ name: "x", entities: ["a"] }], kw_decimals: -1 }), /kw_decimals/);
});

console.log(`\n${passed} passed`);
