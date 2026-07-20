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

test("panels below the labelling floor show shading only", () => {
  // Default floor is 5 W.
  const el = render([{ name: "W", values: [0, 1, 4, 5, 6, 265] }]);
  assert.deepEqual(text(el, ".val"), ["", "", "", "5", "6", "265"]);
});

test("the labelling floor is configurable", () => {
  const el = render([{ name: "W", values: [0, 4, 20, 60] }], { min_label_value: 50 });
  assert.deepEqual(text(el, ".val"), ["", "", "", "60"]);
});

test("a floor of zero labels everything, including a sleeping panel", () => {
  const el = render([{ name: "W", values: [0, 3] }], { min_label_value: 0 });
  assert.deepEqual(text(el, ".val"), ["0", "3"]);
});

test("hiding a label leaves the cell, its shading and its hover text alone", () => {
  const el = render([{ name: "W", values: [2] }]);
  assert.equal(q(el, ".cell").length, 1);
  assert.equal(q(el, ".val").length, 1, "the label element should stay, just empty");
  assert.match(el.querySelector(".cell").title, /2 W$/);
  assert.notEqual(el.querySelector(".fill").style.opacity, "0", "shading should survive");
});

test("the floor never hides a bank total", () => {
  const el = render([{ name: "W", values: [1, 2] }]);
  assert.equal(el.querySelector(".bank-total").textContent, "3 W");
});

test("the producing count uses the same floor as the labels", () => {
  // Two panels trickling below the floor: no labels, and not counted.
  const el = render([{ name: "W", values: [1, 2, 265] }]);
  assert.deepEqual(text(el, ".val"), ["", "", "265"]);
  assert.equal(el.querySelector(".bank-count").textContent, "1/3 producing");
});

test("a raised floor moves the count with it", () => {
  const el = render([{ name: "W", values: [20, 60, 265] }], { min_label_value: 50 });
  assert.equal(el.querySelector(".bank-count").textContent, "2/3 producing");
});

test("a zero floor still doesn't count a panel making nothing", () => {
  const el = render([{ name: "W", values: [0, 1, 2] }], { min_label_value: 0 });
  assert.deepEqual(text(el, ".val"), ["0", "1", "2"]);
  assert.equal(el.querySelector(".bank-count").textContent, "2/3 producing");
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

test("totals cross into kW at a kilowatt, regardless of config", () => {
  assert.equal(
    render([{ name: "W", values: [500, 500] }]).querySelector(".bank-total").textContent,
    "1.0 kW"
  );
  assert.equal(
    render([{ name: "W", values: [500, 499] }]).querySelector(".bank-total").textContent,
    "999 W"
  );
  // A leftover watt_threshold from an older config is ignored, not honoured.
  assert.equal(
    render([{ name: "W", values: [500, 500] }], { watt_threshold: 5000 })
      .querySelector(".bank-total").textContent,
    "1.0 kW"
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

console.log("editor");

/**
 * An editor wired up the way HA wires it, with a config-changed spy.
 *
 * `roundTrip` reproduces what the real card editor does: every config-changed
 * is fed straight back in through setConfig. That round trip replaces the
 * editor's config object, so anything the DOM captured by reference goes stale
 * - which is exactly how the delete-an-empty-panel bug got in.
 */
function editor(config, states = {}, { roundTrip = false } = {}) {
  const el = Card.getConfigElement();
  const emitted = [];
  el.addEventListener("config-changed", (e) => {
    emitted.push(JSON.parse(JSON.stringify(e.detail.config)));
    if (roundTrip) el.setConfig(JSON.parse(JSON.stringify(e.detail.config)));
  });
  window.document.body.appendChild(el);
  el.hass = { states };
  el.setConfig(config);
  return { el, emitted, last: () => emitted[emitted.length - 1] };
}

test("the card offers an editor element", () => {
  assert.equal(Card.getConfigElement().tagName.toLowerCase(), "solar-bank-card-editor");
});

test("an empty bank is renderable, so a new bank can be filled in", () => {
  // The editor's own starting point must survive setConfig.
  const el = window.document.createElement("solar-bank-card");
  assert.doesNotThrow(() => el.setConfig(Card.getStubConfig()));
  window.document.body.appendChild(el);
  el.hass = { states: {} };
  assert.equal(q(el, ".cell").length, 0);
  assert.equal(el.querySelector(".grid").style.gridTemplateColumns, "repeat(1, minmax(0, 1fr))");
});

test("adding a bank emits a config with an empty bank", () => {
  const { el, last } = editor({ banks: [] });
  el.querySelector('[data-action=add-bank]').dispatchEvent(new window.Event("click"));
  assert.equal(last().banks.length, 1);
  assert.deepEqual(last().banks[0].entities, []);
});

test("adding a panel appends an empty slot to that bank only", () => {
  const { el, last } = editor({ banks: [{ name: "W", entities: [] }, { name: "E", entities: [] }] });
  const adds = q(el, "[data-action=add-panel]");
  assert.equal(adds.length, 2);
  adds[1].dispatchEvent(new window.Event("click"));
  assert.deepEqual(last().banks[0].entities, []);
  assert.deepEqual(last().banks[1].entities, [""]);
});

test("typing an entity id updates that panel without rebuilding the DOM", () => {
  const { el, last } = editor({ banks: [{ name: "W", entities: [""] }] });
  const input = q(el, ".panels input")[0];
  input.value = "sensor.inverter_1_west";
  input.dispatchEvent(new window.Event("input"));
  assert.deepEqual(last().banks[0].entities, ["sensor.inverter_1_west"]);
  // Same node still in the document: focus and caret survive a keystroke.
  assert.equal(q(el, ".panels input")[0], input);
});

test("removing a panel and a bank both work", () => {
  const { el, last } = editor({ banks: [{ name: "W", entities: ["a", "b"] }, { name: "E", entities: ["c"] }] });
  q(el, "[data-action=panel-remove]")[1].dispatchEvent(new window.Event("click"));
  assert.deepEqual(last().banks[0].entities, ["a"]);
  const bankRemove = q(el, "[data-action=bank-remove]");
  bankRemove[bankRemove.length - 1].dispatchEvent(new window.Event("click"));
  assert.equal(last().banks.length, 1);
  assert.equal(last().banks[0].name, "W");
});

test("reordering moves banks and panels", () => {
  const { el, last } = editor({ banks: [{ name: "W", entities: ["a", "b"] }, { name: "E", entities: [] }] });
  // Second bank's up arrow.
  q(el, "[data-action=bank-up]")[1].dispatchEvent(new window.Event("click"));
  assert.deepEqual(last().banks.map((b) => b.name), ["E", "W"]);
  // In the rebuilt DOM, move the now-second bank's first panel down.
  q(el, "[data-action=panel-down]")[0].dispatchEvent(new window.Event("click"));
  assert.deepEqual(last().banks[1].entities, ["b", "a"]);
});

test("a number set back to its default is dropped from the config", () => {
  const { el, last } = editor({ banks: [{ name: "W", entities: [] }], max_value: 250 });
  const num = q(el, "input.num")[0];
  num.value = "300";
  num.dispatchEvent(new window.Event("input"));
  assert.equal("max_value" in last(), false);
});

test("unticking show values writes the explicit false", () => {
  const { el, last } = editor({ banks: [{ name: "W", entities: [] }] });
  const box = q(el, "input[type=checkbox]")[0];
  assert.equal(box.checked, true);
  box.checked = false;
  box.dispatchEvent(new window.Event("change"));
  assert.equal(last().show_values, false);
});

test("the entity datalist offers power sensors only (fallback path)", () => {
  const states = {
    "sensor.inverter_1": { state: "1", attributes: { device_class: "power" } },
    "sensor.inverter_2": { state: "1", attributes: { device_class: "power" } },
    "sensor.bedroom_temp": { state: "20", attributes: { device_class: "temperature" } },
    "light.kitchen": { state: "on", attributes: {} },
  };
  const { el } = editor({ banks: [{ name: "W", entities: [] }] }, states);
  const opts = q(el, "datalist option").map((o) => o.value);
  assert.deepEqual(opts, ["sensor.inverter_1", "sensor.inverter_2"]);
});

test("each editor gets its own datalist id, so inputs bind to the right list", () => {
  const states = { "sensor.a": { state: "1", attributes: { device_class: "power" } } };
  const cfg = { banks: [{ name: "W", entities: ["sensor.a"] }] };
  const one = editor(cfg, states);
  const two = editor(cfg, states);
  const idOf = (e) => e.querySelector("datalist").id;
  assert.notEqual(idOf(one.el), idOf(two.el));
  // Each panel input points at its own editor's list.
  assert.equal(q(two.el, ".panels input")[0].getAttribute("list"), idOf(two.el));
  assert.equal(q(one.el, ".panels input")[0].getAttribute("list"), idOf(one.el));
  assert.equal(q(two.el, "datalist option").length, 1);
});

test("editing does not mutate the config object HA passed in", () => {
  const original = { banks: [{ name: "W", entities: ["a"] }] };
  const { el, last } = editor(original);
  el.querySelector('[data-action=add-bank]').dispatchEvent(new window.Event("click"));
  assert.equal(original.banks.length, 1);
  assert.equal(last().banks.length, 2);
});

console.log("iconography");

test("without ha-icon defined, buttons still show something visible", () => {
  // jsdom has no HA frontend, so this exercises the fallback path.
  const { el } = editor({ banks: [{ name: "W", entities: ["a"] }] });
  assert.equal(el.querySelector("ha-icon"), null);
  const up = el.querySelector("[data-action=panel-up]");
  assert.equal(up.textContent.trim(), "↑");
  assert.equal(up.getAttribute("aria-label"), "Move panel up");
});

test("with ha-icon defined, every button uses an mdi glyph", () => {
  window.customElements.define("ha-icon", class extends window.HTMLElement {});
  const { el } = editor({ banks: [{ name: "W", entities: ["a", "b"] }] });

  const icons = q(el, "button ha-icon").map((i) => i.getAttribute("icon"));
  assert.ok(icons.length >= 8, `expected icons on every button, saw ${icons.length}`);
  assert.ok(icons.every((i) => i.startsWith("mdi:")), `non-mdi icon: ${icons}`);

  const iconOf = (action) => el.querySelector(`[data-action=${action}] ha-icon`).getAttribute("icon");
  assert.equal(iconOf("bank-up"), "mdi:arrow-up");
  assert.equal(iconOf("bank-down"), "mdi:arrow-down");
  assert.equal(iconOf("bank-remove"), "mdi:delete");
  assert.equal(iconOf("panel-remove"), "mdi:close");
  assert.equal(iconOf("add-bank"), "mdi:plus");
  assert.equal(iconOf("add-panel"), "mdi:plus");

  // No text glyphs left anywhere once the real element is available.
  const glyphs = q(el, "button").map((b) => b.textContent).join("");
  assert.equal(/[↑↓✕]/.test(glyphs), false, `text glyph survived: ${glyphs}`);
});

test("icon-only buttons keep an accessible name", () => {
  const { el } = editor({ banks: [{ name: "W", entities: ["a"] }] });
  for (const b of q(el, "button.icon")) {
    assert.ok(b.getAttribute("aria-label"), `missing aria-label on ${b.dataset.action}`);
  }
});

console.log("colour override");

const fillOf = (el, i = 0) => q(el, ".grid")[i].parentElement.style.getPropertyValue("--sbc-fill");

test("no colour set leaves the theme's active colour in charge", () => {
  const el = render([{ name: "W", values: [1] }]);
  assert.equal(fillOf(el), "");
});

test("a card colour applies to every bank", () => {
  const el = render([{ name: "W", values: [1] }, { name: "E", values: [1] }], { color: "amber" });
  assert.equal(fillOf(el, 0), "var(--amber-color)");
  assert.equal(fillOf(el, 1), "var(--amber-color)");
});

test("banks share the card's colour; a stray per-bank colour is ignored", () => {
  // The shading already carries a variable - a second one per bank would
  // compete with it, so bank.color is deliberately not honoured.
  const el = window.document.createElement("solar-bank-card");
  el.setConfig({
    color: "amber",
    banks: [
      { name: "W", entities: ["sensor.x"], color: "deep-orange" },
      { name: "E", entities: ["sensor.y"] },
    ],
  });
  window.document.body.appendChild(el);
  el.hass = { states: {} };
  assert.equal(fillOf(el, 0), "var(--amber-color)");
  assert.equal(fillOf(el, 1), "var(--amber-color)");
});

test("meaningless colour values fall back rather than emitting broken CSS", () => {
  for (const color of ["none", "default", "state", "", null]) {
    const el = render([{ name: "W", values: [1] }], { color });
    assert.equal(fillOf(el), "", `expected no fill for ${JSON.stringify(color)}`);
  }
});

test("a hand-edited config can't inject CSS through the colour", () => {
  for (const color of ["red; background: url(x)", "red)", "--evil", "RED", "1red"]) {
    const el = render([{ name: "W", values: [1] }], { color });
    assert.equal(fillOf(el), "", `expected rejection of ${JSON.stringify(color)}`);
  }
});

test("changing only the colour rebuilds the card", () => {
  const el = window.document.createElement("solar-bank-card");
  const cfg = { banks: [{ name: "W", entities: ["sensor.x"] }] };
  el.setConfig(cfg);
  window.document.body.appendChild(el);
  el.hass = { states: {} };
  assert.equal(fillOf(el), "");
  el.setConfig({ ...cfg, color: "green" });
  el.hass = { states: {} };
  assert.equal(fillOf(el), "var(--green-color)", "colour change did not reach the DOM");
});

console.log("theme tokens");

const styleOf = (el) => el.querySelector("style").textContent;

test("no hardcoded colours in either stylesheet", () => {
  const card = styleOf(render([{ name: "W", values: [1] }]));
  const ed = styleOf(editor({ banks: [{ name: "W", entities: ["a"] }] }).el);
  for (const [name, css] of [["card", card], ["editor", ed]]) {
    const hex = css.match(/#[0-9a-fA-F]{3,8}\b/g);
    assert.equal(hex, null, `${name} stylesheet has literal colours: ${hex}`);
    // rgb()/hsl() literals are equally hardcoded, bar the one neutral hover wash.
    const fn = (css.match(/\b(rgb|hsl)a?\([^)]*\)/g) || [])
      .filter((v) => !v.startsWith("rgba(127,127,127"));
    assert.deepEqual(fn, [], `${name} stylesheet has literal colours: ${fn}`);
  }
});

test("every colour resolves through a theme variable", () => {
  const css = styleOf(render([{ name: "W", values: [1] }]));
  for (const decl of css.match(/(?:^|[\s;{])(?:color|background)\s*:[^;}]+/g) || []) {
    assert.match(decl, /var\(--/, `not themed: ${decl.trim()}`);
  }
});

test("font sizes and radii come from HA tokens, with literals only as fallbacks", () => {
  for (const css of [styleOf(render([{ name: "W", values: [1] }])),
                     styleOf(editor({ banks: [{ name: "W", entities: ["a"] }] }).el)]) {
    for (const decl of css.match(/font-size\s*:[^;}]+/g) || []) {
      assert.match(decl, /var\(--ha-font-size/, `not tokenised: ${decl.trim()}`);
    }
    for (const decl of css.match(/font-weight\s*:[^;}]+/g) || []) {
      assert.match(decl, /var\(--ha-font-weight/, `not tokenised: ${decl.trim()}`);
    }
    for (const decl of css.match(/border-radius\s*:[^;}]+/g) || []) {
      assert.match(decl, /var\(--ha-border-radius/, `not tokenised: ${decl.trim()}`);
    }
  }
});

console.log("ha components");

// Minimal stand-ins for the frontend's elements. Registering them switches the
// editor onto its preferred path, so this group runs last.
for (const tag of ["ha-textfield", "ha-switch", "ha-formfield", "ha-icon-button", "ha-button"]) {
  window.customElements.define(tag, class extends window.HTMLElement {});
}

test("text and number fields use ha-textfield", () => {
  const { el } = editor({ banks: [{ name: "W", entities: ["sensor.a"] }] });
  assert.ok(q(el, "ha-textfield").length >= 5, "expected ha-textfield for title, numbers, bank, panel");
  assert.equal(q(el, "input[type=text]").length, 0, "native text input survived");
  assert.equal(q(el, "input[type=number]").length, 0, "native number input survived");
});

test("editing an ha-textfield still emits the config", () => {
  const { el, last } = editor({ banks: [{ name: "W", entities: [""] }] });
  const panel = q(el, ".panels ha-textfield")[0];
  panel.value = "sensor.inverter_1_west";
  panel.dispatchEvent(new window.Event("input"));
  assert.deepEqual(last().banks[0].entities, ["sensor.inverter_1_west"]);
});

test("the boolean uses ha-switch inside ha-formfield", () => {
  const { el, last } = editor({ banks: [{ name: "W", entities: [] }] });
  const sw = el.querySelector("ha-formfield ha-switch");
  assert.ok(sw, "expected ha-switch");
  assert.equal(q(el, "input[type=checkbox]").length, 0, "native checkbox survived");
  sw.checked = false;
  sw.dispatchEvent(new window.Event("change"));
  assert.equal(last().show_values, false);
});

test("icon buttons become ha-icon-button and still act", () => {
  const { el, last } = editor({ banks: [{ name: "W", entities: ["a", "b"] }] });
  const remove = q(el, "ha-icon-button[data-action=panel-remove]");
  assert.equal(remove.length, 2);
  assert.equal(el.querySelector("button.icon"), null, "native icon button survived");
  remove[0].dispatchEvent(new window.Event("click"));
  assert.deepEqual(last().banks[0].entities, ["b"]);
});

test("add buttons become ha-button and still act", () => {
  const { el, last } = editor({ banks: [] });
  const add = el.querySelector("ha-button[data-action=add-bank]");
  assert.ok(add, "expected ha-button");
  add.dispatchEvent(new window.Event("click"));
  assert.equal(last().banks.length, 1);
});

console.log("edits survive HA's round trip");

const click = (el, action, i = 0) =>
  q(el, `[data-action=${action}]`)[i].dispatchEvent(new window.Event("click"));

test("an empty panel can be added and then deleted", () => {
  const { el, last } = editor({ banks: [{ name: "W", entities: [] }] }, {}, { roundTrip: true });
  click(el, "add-panel");
  assert.deepEqual(last().banks[0].entities, [""]);
  click(el, "panel-remove");
  assert.deepEqual(last().banks[0].entities, [], "delete did nothing after a round trip");
});

test("a filled panel can be deleted after a round trip", () => {
  const { el, last } = editor(
    { banks: [{ name: "W", entities: ["sensor.a", "sensor.b"] }] }, {}, { roundTrip: true });
  click(el, "panel-remove", 0);
  assert.deepEqual(last().banks[0].entities, ["sensor.b"]);
});

test("a bank can be added and then deleted", () => {
  const { el, last } = editor({ banks: [{ name: "W", entities: [] }] }, {}, { roundTrip: true });
  click(el, "add-bank");
  assert.equal(last().banks.length, 2);
  click(el, "bank-remove", 1);
  assert.equal(last().banks.length, 1);
  assert.equal(last().banks[0].name, "W");
});

test("renaming a bank sticks across round trips", () => {
  const { el, last } = editor({ banks: [{ name: "W", entities: [] }] }, {}, { roundTrip: true });
  click(el, "add-bank");
  // The bank name field is ha-textfield or a native input depending on what is
  // registered; the class is on whichever one it built.
  const nameField = q(el, ".bank-name-field")[1];
  nameField.value = "East";
  nameField.dispatchEvent(new window.Event("input"));
  assert.equal(last().banks[1].name, "East");
});

test("reordering still works once the config has round-tripped", () => {
  const { el, last } = editor(
    { banks: [{ name: "W", entities: ["a", "b"] }] }, {}, { roundTrip: true });
  click(el, "add-panel");
  assert.deepEqual(last().banks[0].entities, ["a", "b", ""]);
  click(el, "panel-up", 1);
  assert.deepEqual(last().banks[0].entities, ["b", "a", ""]);
});

test("repeated add and delete leaves no residue", () => {
  const { el, last } = editor({ banks: [{ name: "W", entities: [] }] }, {}, { roundTrip: true });
  for (let i = 0; i < 3; i += 1) {
    click(el, "add-panel");
    click(el, "panel-remove");
  }
  assert.deepEqual(last().banks[0].entities, []);
  assert.equal(q(el, ".panels [data-action=panel-remove]").length, 0);
});

console.log("entity picker");

test("panels use ha-entity-picker, wired to hass and filtered to power sensors", () => {
  window.customElements.define("ha-entity-picker", class extends window.HTMLElement {});
  const states = { "sensor.a": { state: "1", attributes: { unit_of_measurement: "W" } } };
  const { el } = editor({ banks: [{ name: "W", entities: ["sensor.a", ""] }] }, states);

  const pickers = q(el, "ha-entity-picker");
  assert.equal(pickers.length, 2, "one picker per panel");
  assert.equal(pickers[0].value, "sensor.a");
  assert.ok(pickers[0].hass, "picker never got hass");
  assert.deepEqual(pickers[0].includeDomains, ["sensor"]);
  assert.deepEqual(pickers[0].includeDeviceClasses, ["power"]);
  assert.equal(pickers[0].allowCustomEntity, true);
  // No typing required any more.
  assert.equal(q(el, ".panels ha-textfield").length, 0);
  assert.equal(q(el, ".panels input").length, 0);
});

test("the datalist fallback offers the same power sensors as the picker", () => {
  const states = {
    "sensor.inverter_1": { state: "1", attributes: { device_class: "power" } },
    "sensor.house_energy": { state: "1", attributes: { device_class: "energy" } },
    "sensor.bedroom_temp": { state: "20", attributes: { device_class: "temperature" } },
    "sensor.no_class": { state: "5", attributes: {} },
  };
  const { el } = editor({ banks: [{ name: "W", entities: [] }] }, states);
  assert.deepEqual(q(el, "datalist option").map((o) => o.value), ["sensor.inverter_1"]);
});

test("choosing an entity emits the config and stops the picker's own event", () => {
  const states = { "sensor.a": { state: "1", attributes: {} } };
  const { el, last } = editor({ banks: [{ name: "W", entities: [""] }] }, states);
  const picker = q(el, "ha-entity-picker")[0];

  let escaped = false;
  el.addEventListener("value-changed", () => { escaped = true; });
  const ev = new window.CustomEvent("value-changed", {
    detail: { value: "sensor.a" }, bubbles: true, composed: true,
  });
  picker.dispatchEvent(ev);

  assert.deepEqual(last().banks[0].entities, ["sensor.a"]);
  assert.equal(escaped, false, "picker's value-changed leaked to the editor host");
});

test("clearing a picker writes an empty slot rather than undefined", () => {
  const { el, last } = editor({ banks: [{ name: "W", entities: ["sensor.a"] }] });
  const picker = q(el, "ha-entity-picker")[0];
  picker.dispatchEvent(new window.CustomEvent("value-changed", { detail: { value: undefined } }));
  assert.deepEqual(last().banks[0].entities, [""]);
});

test("later hass updates reach every picker", () => {
  const { el } = editor({ banks: [{ name: "W", entities: ["a", "b"] }] });
  const fresh = { states: { "sensor.new": { state: "5", attributes: {} } } };
  el.hass = fresh;
  for (const p of q(el, "ha-entity-picker")) assert.equal(p.hass, fresh);
});

test("colour uses HA's ui_color selector, per card and per bank", () => {
  window.customElements.define("ha-selector", class extends window.HTMLElement {});
  const { el, last } = editor({ banks: [{ name: "W", entities: [] }] }, {}, { roundTrip: true });

  const colors = q(el, "ha-selector.color-field");
  assert.equal(colors.length, 1, "colour belongs to the card, not to each bank");
  assert.deepEqual(colors[0].selector, { ui_color: { include_none: true } });
  assert.ok(colors[0].hass, "colour picker never got hass");

  colors[0].dispatchEvent(new window.CustomEvent("value-changed", { detail: { value: "amber" } }));
  assert.equal(last().color, "amber");
});

test("clearing a colour removes the key rather than storing none", () => {
  const { el, last } = editor({ color: "amber", banks: [{ name: "W", entities: [] }] },
    {}, { roundTrip: true });
  const color = q(el, "ha-selector.color-field")[0];
  color.dispatchEvent(new window.CustomEvent("value-changed", { detail: { value: "none" } }));
  assert.equal("color" in last(), false);
  color.dispatchEvent(new window.CustomEvent("value-changed", { detail: { value: "amber" } }));
  color.dispatchEvent(new window.CustomEvent("value-changed", { detail: { value: "" } }));
  assert.equal("color" in last(), false);
});

test("button text is a child node, so it renders in a slot-based button", () => {
  // ha-button ignores a `label` property - the text must be in the default
  // slot, or the button renders blank.
  const { el } = editor({ banks: [{ name: "W", entities: [] }] });
  for (const [action, label] of [["add-bank", "Add bank"], ["add-panel", "Add panel"]]) {
    const b = el.querySelector(`[data-action=${action}]`);
    assert.equal(b.textContent.trim(), label, `${action} has no visible text`);
    const own = [...b.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() === label);
    assert.ok(own, `${action} label is not a child text node`);
  }
});

console.log(`\n${passed} passed`);
