/**
 * solar-bank-card
 *
 * A compact per-panel view for microinverter arrays. Each configured "bank"
 * renders as one header row (name, live total, producing count) plus a tight
 * grid of one cell per panel, shaded by output. Tapping a cell opens the
 * normal more-info dialog for that inverter.
 *
 * Dependency-free plain custom element - no Lit, no build step.
 */

const CARD_VERSION = "1.7.1";
console.info(`%c SOLAR-BANK-CARD ${CARD_VERSION} `, "background:#f6a800;color:#000");

const DEFAULT_MAX = 300; // W per panel at full output
const IDLE_W = 1; // below this a panel counts as asleep

// Option names and defaults deliberately match power-flow-card-plus, so a
// dashboard carrying both cards can be made to agree by copying the values
// across rather than translating between two vocabularies.
const DEFAULT_W_DECIMALS = 0;
const DEFAULT_KW_DECIMALS = 1;
const DEFAULT_WATT_THRESHOLD = 1000;

class SolarBankCard extends HTMLElement {
  setConfig(config) {
    if (!config || !Array.isArray(config.banks) || !config.banks.length) {
      throw new Error("solar-bank-card: `banks` must be a non-empty list");
    }
    // An empty entities list is allowed, not an error: the editor creates a
    // bank first and fills it afterwards, so the intermediate config has to be
    // renderable. Only a missing or non-list `entities` is a mistake.
    config.banks.forEach((b, i) => {
      if (!Array.isArray(b.entities)) {
        throw new Error(`solar-bank-card: bank ${i + 1} needs an \`entities\` list`);
      }
    });
    const num = (value, fallback, label) => {
      if (value === undefined || value === null) return fallback;
      const n = Number(value);
      if (!isFinite(n) || n < 0) {
        throw new Error(`solar-bank-card: \`${label}\` must be a non-negative number`);
      }
      return n;
    };

    this._config = config;
    this._fmtOpts = {
      w: num(config.w_decimals, DEFAULT_W_DECIMALS, "w_decimals"),
      kw: num(config.kw_decimals, DEFAULT_KW_DECIMALS, "kw_decimals"),
      threshold: num(config.watt_threshold, DEFAULT_WATT_THRESHOLD, "watt_threshold"),
    };
    this._sig = null;
  }

  /**
   * Watts formatted per config: below watt_threshold as W, above it as kW.
   * A threshold of 0 therefore means "always kW" and a huge one means
   * "never kW", which is the whole range of behaviour anyone has asked for.
   */
  _fmt(w) {
    const { w: wd, kw: kwd, threshold } = this._fmtOpts;
    // Compare what will actually be shown, not the raw value: 999.6 W rounds
    // to "1000" at zero decimals, and printing "1000 W" next to a threshold of
    // 1000 looks like a bug even though the arithmetic is right.
    const rounded = Number(w.toFixed(wd));
    return Math.abs(rounded) >= threshold
      ? `${(w / 1000).toFixed(kwd)} kW`
      : `${rounded.toFixed(wd)} W`;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    // Build once, then only push values. The signature covers everything that
    // changes DOM structure so a config edit rebuilds but a state tick doesn't.
    const sig = JSON.stringify([this._config.title, this._config.banks]);
    if (sig !== this._sig) {
      this._sig = sig;
      this._build();
    }
    this._update();
  }

  getCardSize() {
    return 1 + this._config.banks.length;
  }

  /**
   * Only consulted when the card is dropped straight into a sections view; a
   * vertical-stack hands it the full width already. Sections give an unknown
   * custom card a narrow default column, which squeezes the panels down to
   * slivers, so ask for the whole width and keep the floor high - some setups
   * ignore "full" and fall back to min_columns.
   */
  getGridOptions() {
    return { columns: "full", rows: "auto", min_columns: 12 };
  }

  /** Watts for an entity, normalised to W (a kW-unit sensor is scaled up). */
  _watts(id) {
    const st = this._hass.states[id];
    if (!st) return null;
    const v = Number(st.state);
    if (!isFinite(v)) return null;
    const unit = (st.attributes.unit_of_measurement || "W").toLowerCase();
    return unit === "kw" ? v * 1000 : v;
  }

  _build() {
    const c = this._config;
    this.innerHTML = "";

    const card = document.createElement("ha-card");
    if (c.title) card.setAttribute("header", c.title);

    const style = document.createElement("style");
    style.textContent = `
      .wrap { padding: 8px 16px 16px; display: flex; flex-direction: column; gap: 14px; }
      /* Nothing in the header may wrap: a wrapped "0/9 producing" or "0 W"
         reads as broken rather than as merely tight. The name is the only
         part allowed to ellipsize. */
      .bank-head {
        display: flex; align-items: baseline; gap: 8px; flex-wrap: nowrap;
        font-family: var(--ha-font-family-body, inherit);
        font-size: var(--ha-font-size-m, 14px);
        color: var(--secondary-text-color);
      }
      .bank-name {
        font-weight: var(--ha-font-weight-medium, 500);
        color: var(--primary-text-color);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .bank-total { margin-left: auto; font-variant-numeric: tabular-nums;
                    color: var(--primary-text-color);
                    font-weight: var(--ha-font-weight-medium, 500);
                    white-space: nowrap; flex: 0 0 auto; }
      .bank-count { font-size: var(--ha-font-size-s, 12px);
                    white-space: nowrap; min-width: 0;
                    overflow: hidden; text-overflow: ellipsis; }
      /* Exactly one row per bank, always. Every bank gets the widest bank's
         column count (set inline) so cells are the same size in every row and
         line up vertically - comparing east against west is a glance down the
         card. Columns are 1fr rather than a fixed cap so the widest bank spans
         the full content width, putting its last cell flush with the right
         edge where the bank total sits. */
      .grid { display: grid; gap: 4px; margin-top: 6px; }
      .cell {
        position: relative; aspect-ratio: 1; cursor: pointer;
        border-radius: var(--ha-border-radius-sm, 4px);
        background: var(--divider-color);
        transition: background-color 240ms ease-out;
      }
      .cell .fill {
        position: absolute; inset: 0;
        border-radius: var(--ha-border-radius-sm, 4px);
        background: var(--state-icon-active-color, var(--primary-color));
        opacity: 0; transition: opacity 240ms ease-out;
      }
      .cell.dead { outline: 1px dashed var(--error-color); outline-offset: -1px; }
      .cell:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 1px; }
      /* Centred both ways over the fill. pointer-events stay off so the label
         never eats a click meant for the cell underneath. */
      .val {
        position: absolute; inset: 0; pointer-events: none;
        display: flex; align-items: center; justify-content: center;
        font-family: var(--ha-font-family-body, inherit);
        font-size: var(--ha-font-size-s, 12px);
        font-weight: var(--ha-font-weight-medium, 500);
        line-height: 1; font-variant-numeric: tabular-nums;
        color: var(--primary-text-color);
      }
      /* A filled cell is a saturated block, so the label has to flip to the
         theme's on-accent colour or it disappears into the fill. */
      .cell.hot .val { color: var(--text-primary-color); }
      /* Below roughly 28px a three-digit number stops being legible and starts
         being noise; the hover text still has it. */
      .grid.tight .val { display: none; }
    `;

    const wrap = document.createElement("div");
    wrap.className = "wrap";
    this._cells = [];

    // At least one column: an all-empty config would otherwise emit
    // repeat(0, ...), which is invalid and drops the grid entirely.
    const columns = Math.max(1, ...c.banks.map((b) => b.entities.length));
    const showValues = c.show_values !== false;
    this._grids = [];

    c.banks.forEach((bank, bi) => {
      const sec = document.createElement("div");

      const head = document.createElement("div");
      head.className = "bank-head";
      const name = document.createElement("span");
      name.className = "bank-name";
      name.textContent = bank.name || `Bank ${bi + 1}`;
      const count = document.createElement("span");
      count.className = "bank-count";
      const total = document.createElement("span");
      total.className = "bank-total";
      head.append(name, count, total);

      const grid = document.createElement("div");
      grid.className = "grid";
      grid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
      this._grids.push(grid);

      const cells = bank.entities.map((id) => {
        const cell = document.createElement("div");
        cell.className = "cell";
        cell.tabIndex = 0;
        cell.setAttribute("role", "button");
        const fill = document.createElement("div");
        fill.className = "fill";
        cell.appendChild(fill);
        let val = null;
        if (showValues) {
          val = document.createElement("span");
          val.className = "val";
          cell.appendChild(val);
        }
        const open = () => this._moreInfo(id);
        cell.addEventListener("click", open);
        cell.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open();
          }
        });
        grid.appendChild(cell);
        return { id, cell, fill, val };
      });

      sec.append(head, grid);
      wrap.appendChild(sec);
      this._cells.push({ bank, cells, count, total });
    });

    card.append(style, wrap);
    this.appendChild(card);
    if (showValues) this._watchWidth(columns);
  }

  /**
   * Cell width depends on the card's width, which the card can't know: it lands
   * in stacks, sections and popups of every size. Measure instead of guessing,
   * and drop the labels once a cell is too small to hold one.
   */
  _watchWidth(columns) {
    this._unwatch();
    if (typeof ResizeObserver === "undefined") return;
    const GAP = 4;
    const MIN_CELL = 28;
    this._ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cell = (entry.contentRect.width - GAP * (columns - 1)) / columns;
        entry.target.classList.toggle("tight", cell < MIN_CELL);
      }
    });
    this._grids.forEach((g) => this._ro.observe(g));
  }

  _unwatch() {
    if (this._ro) {
      this._ro.disconnect();
      this._ro = null;
    }
  }

  disconnectedCallback() {
    this._unwatch();
  }

  _update() {
    const max = this._config.max_value || DEFAULT_MAX;

    this._cells.forEach(({ bank, cells, count, total }) => {
      let sum = 0;
      let live = 0;
      let unknown = 0;

      cells.forEach(({ id, cell, fill, val }) => {
        const w = this._watts(id);
        if (w === null) {
          unknown += 1;
          cell.classList.add("dead");
          cell.classList.remove("hot");
          fill.style.opacity = 0;
          cell.title = `${id}: unavailable`;
          if (val) val.textContent = "—";
          return;
        }
        cell.classList.remove("dead");
        sum += w;
        if (w >= IDLE_W) live += 1;
        // Opacity carries the magnitude; the hue stays the theme's active
        // colour so this reads correctly in light and dark themes.
        const frac = Math.max(0, Math.min(1, w / max));
        fill.style.opacity = frac === 0 ? 0 : 0.15 + frac * 0.85;
        // Past halfway the fill is dark enough that body text stops reading
        // against it, so the label swaps to the on-accent colour.
        cell.classList.toggle("hot", frac >= 0.5);
        const nm = this._hass.states[id].attributes.friendly_name || id;
        cell.title = `${nm}: ${this._fmt(w)}`;
        // Bare number: the unit is already on the bank total, and at nine
        // columns "265 W" crowds the cell in a way "265" does not.
        if (val) val.textContent = w.toFixed(this._fmtOpts.w);
      });

      const n = cells.length;
      count.textContent = unknown
        ? `${live}/${n} producing · ${unknown} offline`
        : `${live}/${n} producing`;
      total.textContent = this._fmt(sum);
    });
  }

  _moreInfo(entityId) {
    this.dispatchEvent(
      new CustomEvent("hass-more-info", {
        detail: { entityId },
        bubbles: true,
        composed: true,
      })
    );
  }

  static getConfigElement() {
    return document.createElement("solar-bank-card-editor");
  }

  static getStubConfig() {
    return { title: "Solar Generation", banks: [{ name: "Bank A", entities: [] }] };
  }
}

/**
 * Visual editor.
 *
 * Native inputs throughout, deliberately: ha-entity-picker and friends are only
 * defined once something else in the frontend has pulled them in, so a card that
 * reaches for them renders an empty editor at the wrong moment. A datalist gives
 * the same type-to-filter behaviour with nothing to load.
 *
 * The DOM is rebuilt only when the *shape* of the config changes - a bank or a
 * panel added, removed or moved. Typing in a field mutates the config and emits
 * config-changed without touching the DOM, because rebuilding mid-keystroke
 * would take the focus and the caret with it.
 */
class SolarBankCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = JSON.parse(JSON.stringify(config || {}));
    if (!Array.isArray(this._config.banks)) this._config.banks = [];
    if (this._shape() !== this._builtShape) this._render();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    // Entity ids only need collecting once; hass updates every state change.
    if (first) this._fillEntityOptions();
  }

  /** Structural fingerprint - changes only when the DOM needs rebuilding. */
  _shape() {
    return this._config.banks.map((b) => (b.entities || []).length).join(",") +
      `|${this._config.banks.length}`;
  }

  _emit({ rebuild = false } = {}) {
    if (rebuild) this._render();
    this.dispatchEvent(new CustomEvent("config-changed", {
      detail: { config: this._config },
      bubbles: true,
      composed: true,
    }));
  }

  /** Power sensors - the plausible candidates for a panel. */
  _fillEntityOptions() {
    const list = this._datalist;
    if (!list || !this._hass) return;
    const ids = Object.keys(this._hass.states)
      .filter((id) => id.startsWith("sensor."))
      .filter((id) => {
        const u = (this._hass.states[id].attributes.unit_of_measurement || "").toLowerCase();
        return u === "w" || u === "kw";
      })
      .sort();
    list.innerHTML = "";
    for (const id of ids) {
      const opt = document.createElement("option");
      opt.value = id;
      const nm = this._hass.states[id].attributes.friendly_name;
      if (nm) opt.label = nm;
      list.appendChild(opt);
    }
  }

  _render() {
    this._builtShape = this._shape();
    this.innerHTML = "";

    const style = document.createElement("style");
    style.textContent = `
      /* Sizes, weights and radii come from Home Assistant's design tokens, with
         a literal only as the fallback for frontends that predate them. */
      .ed { display: flex; flex-direction: column; gap: 24px; padding: 4px 0; }
      .grp { display: flex; flex-direction: column; gap: 12px; }
      .grp > h4 {
        margin: 0;
        font-family: var(--ha-font-family-body, inherit);
        font-size: var(--ha-font-size-s, 13px);
        font-weight: var(--ha-font-weight-medium, 500);
        color: var(--secondary-text-color);
      }
      .row { display: flex; align-items: center; gap: 8px; }
      .row > label {
        flex: 1 1 auto;
        font-size: var(--ha-font-size-m, 14px);
        color: var(--primary-text-color);
      }
      .field { display: block; width: 100%; }
      .grow { flex: 1 1 auto; min-width: 0; }
      /* Native fallbacks only - used when ha-textfield isn't registered. */
      input[type=text], input[type=number] {
        font: inherit; font-size: var(--ha-font-size-m, 14px);
        padding: 8px 10px;
        border-radius: var(--ha-border-radius-sm, 6px);
        background: var(--secondary-background-color, transparent);
        color: var(--primary-text-color);
        border: 1px solid var(--divider-color);
      }
      input:focus-visible { outline: 2px solid var(--primary-color); outline-offset: -1px; }
      input.num { width: 96px; flex: 0 0 auto; text-align: right; }
      input.grow { flex: 1 1 auto; min-width: 0; }
      .bank {
        border: 1px solid var(--divider-color);
        border-radius: var(--ha-border-radius-md, 8px);
        padding: 12px; display: flex; flex-direction: column; gap: 10px;
      }
      .panels { display: flex; flex-direction: column; gap: 8px; }
      .btn {
        font: inherit; font-size: var(--ha-font-size-s, 13px); cursor: pointer;
        border-radius: var(--ha-border-radius-sm, 6px);
        background: transparent; color: var(--primary-color);
        border: 1px solid var(--divider-color); padding: 6px 10px;
        display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      }
      .btn:hover { background: var(--secondary-background-color, rgba(127,127,127,.12)); }
      .btn.icon { padding: 6px; flex: 0 0 auto; line-height: 1; }
      .btn:disabled { opacity: .35; cursor: default; }
      /* Icon size is the frontend's own knob; ha-icon-button reads it too. */
      .btn ha-icon { --mdc-icon-size: 20px; width: 20px; height: 20px; }
      ha-icon-button { --mdc-icon-button-size: 36px; --mdc-icon-size: 20px; }
      .danger { color: var(--error-color); --icon-primary-color: var(--error-color); }
      /* The add buttons sit in flex columns, which would stretch them to the
         full width and turn a small action into a banner. */
      ha-button, mwc-button, .btn {
        align-self: flex-start;
        --mdc-typography-button-text-transform: none;
      }
      .hint {
        font-size: var(--ha-font-size-s, 12px);
        color: var(--secondary-text-color); margin: 0;
      }
    `;

    const ed = document.createElement("div");
    ed.className = "ed";

    // <input list> resolves the id document-wide, so a fixed id would make a
    // second editor's inputs bind to the first editor's datalist. One id per
    // instance, and the element is held by reference rather than looked up.
    this._listId = `sbc-entities-${Math.random().toString(36).slice(2, 9)}`;
    const datalist = document.createElement("datalist");
    datalist.id = this._listId;
    this._datalist = datalist;

    // --- card-level options -------------------------------------------------
    const card = this._group("Card");
    card.append(
      this._textRow("Title", this._config.title || "", (v) => {
        if (v) this._config.title = v; else delete this._config.title;
        this._emit();
      }),
      this._numRow("Full-output watts per panel", this._config.max_value, 300, (v) => {
        this._set("max_value", v, 300);
      }),
      this._checkRow("Show a value on each panel", this._config.show_values !== false, (v) => {
        if (v) delete this._config.show_values; else this._config.show_values = false;
        this._emit();
      })
    );

    // --- formatting ---------------------------------------------------------
    const fmt = this._group("Formatting");
    fmt.append(
      this._numRow("Switch to kW at (W)", this._config.watt_threshold, 1000, (v) => {
        this._set("watt_threshold", v, 1000);
      }),
      this._numRow("Decimals below that", this._config.w_decimals, 0, (v) => {
        this._set("w_decimals", v, 0);
      }),
      this._numRow("Decimals above it", this._config.kw_decimals, 1, (v) => {
        this._set("kw_decimals", v, 1);
      })
    );

    // --- banks --------------------------------------------------------------
    const banks = this._group("Banks");
    this._config.banks.forEach((bank, bi) => banks.appendChild(this._bankBlock(bank, bi)));

    const addBank = this._button("Add bank", "mdi:plus", "+", () => {
      this._config.banks.push({ name: `Bank ${this._config.banks.length + 1}`, entities: [] });
      this._emit({ rebuild: true });
    }, "add-bank");
    banks.appendChild(addBank);

    if (!this._config.banks.length) {
      const hint = document.createElement("p");
      hint.className = "hint";
      hint.textContent = "Add a bank, then add a panel entity to it.";
      banks.insertBefore(hint, addBank);
    }

    ed.append(card, fmt, banks, datalist);
    this.append(style, ed);
    this._fillEntityOptions();
  }

  _bankBlock(bank, bi) {
    const box = document.createElement("div");
    box.className = "bank";

    const head = document.createElement("div");
    head.className = "row";
    const name = this._textRow("Bank name", bank.name || "", (v) => {
      bank.name = v;
      this._emit();
    }, { placeholder: "Bank name" });
    name.classList.add("grow");
    head.append(
      name,
      this._iconButton("Move bank up", "mdi:arrow-up", "↑", bi > 0,
        () => this._moveBank(bi, -1), "bank-up"),
      this._iconButton("Move bank down", "mdi:arrow-down", "↓",
        bi < this._config.banks.length - 1, () => this._moveBank(bi, 1), "bank-down"),
      this._iconButton("Remove bank", "mdi:delete", "✕", true, () => {
        this._config.banks.splice(bi, 1);
        this._emit({ rebuild: true });
      }, "bank-remove", true)
    );

    const panels = document.createElement("div");
    panels.className = "panels";
    const entities = bank.entities || (bank.entities = []);
    entities.forEach((id, pi) => {
      const row = document.createElement("div");
      row.className = "row";
      const input = this._textRow(`Panel ${pi + 1}`, id, (v) => {
        entities[pi] = v;
        this._emit();
      }, { placeholder: "sensor.inverter_…", listId: this._listId });
      input.classList.add("grow");
      row.append(
        input,
        this._iconButton("Move panel up", "mdi:arrow-up", "↑", pi > 0,
          () => this._movePanel(entities, pi, -1), "panel-up"),
        this._iconButton("Move panel down", "mdi:arrow-down", "↓", pi < entities.length - 1,
          () => this._movePanel(entities, pi, 1), "panel-down"),
        this._iconButton("Remove panel", "mdi:close", "✕", true, () => {
          entities.splice(pi, 1);
          this._emit({ rebuild: true });
        }, "panel-remove", true)
      );
      panels.appendChild(row);
    });

    box.append(head, panels, this._button("Add panel", "mdi:plus", "+", () => {
      entities.push("");
      this._emit({ rebuild: true });
    }, "add-panel"));
    return box;
  }

  _moveBank(i, d) {
    const b = this._config.banks;
    [b[i], b[i + d]] = [b[i + d], b[i]];
    this._emit({ rebuild: true });
  }

  _movePanel(list, i, d) {
    [list[i], list[i + d]] = [list[i + d], list[i]];
    this._emit({ rebuild: true });
  }

  /** Numbers: blank or the default drops the key, so configs stay minimal. */
  _set(key, value, fallback) {
    if (value === "" || value === null || Number(value) === fallback) delete this._config[key];
    else this._config[key] = Number(value);
    this._emit();
  }

  _group(title) {
    const g = document.createElement("div");
    g.className = "grp";
    const h = document.createElement("h4");
    h.textContent = title;
    g.appendChild(h);
    return g;
  }

  /**
   * Home Assistant's own form elements when they are registered, native ones
   * when they are not. ha-textfield and ha-switch come from the frontend's
   * component set and are usually present by the time a card editor opens, but
   * "usually" isn't "always" - an editor reached by an unusual route can render
   * before they load, and an unresolved custom element is an invisible box.
   * Falling back keeps the editor usable in that case rather than blank.
   */
  _field(tag) {
    return customElements.get(tag) ? document.createElement(tag) : null;
  }

  _textRow(label, value, onInput, { placeholder = "", listId = null } = {}) {
    const ha = this._field("ha-textfield");
    if (ha) {
      ha.classList.add("field");
      ha.label = label;
      ha.value = value;
      if (placeholder) ha.placeholder = placeholder;
      // ha-textfield wraps an input; the datalist has to reach it directly.
      if (listId) ha.setAttribute("list", listId);
      ha.addEventListener("input", () => onInput(ha.value.trim()));
      return ha;
    }
    const row = document.createElement("div");
    row.className = "row";
    const l = document.createElement("label");
    l.textContent = label;
    const i = document.createElement("input");
    i.type = "text";
    i.className = "grow";
    i.value = value;
    if (placeholder) i.placeholder = placeholder;
    if (listId) i.setAttribute("list", listId);
    i.addEventListener("input", () => onInput(i.value.trim()));
    row.append(l, i);
    return row;
  }

  _numRow(label, value, placeholder, onInput) {
    const shown = value === undefined || value === null ? "" : String(value);
    const ha = this._field("ha-textfield");
    if (ha) {
      ha.classList.add("field");
      ha.label = label;
      ha.type = "number";
      ha.min = 0;
      ha.value = shown;
      ha.helper = `Default ${placeholder}`;
      ha.addEventListener("input", () => onInput(ha.value));
      return ha;
    }
    const row = document.createElement("div");
    row.className = "row";
    const l = document.createElement("label");
    l.textContent = label;
    const i = document.createElement("input");
    i.type = "number";
    i.min = "0";
    i.className = "num";
    i.placeholder = String(placeholder);
    i.value = shown;
    i.addEventListener("input", () => onInput(i.value));
    row.append(l, i);
    return row;
  }

  _checkRow(label, checked, onChange) {
    const sw = this._field("ha-switch");
    const wrap = this._field("ha-formfield");
    if (sw && wrap) {
      sw.checked = checked;
      sw.addEventListener("change", () => onChange(sw.checked));
      wrap.label = label;
      wrap.appendChild(sw);
      wrap.classList.add("field");
      return wrap;
    }
    const row = document.createElement("div");
    row.className = "row";
    const l = document.createElement("label");
    l.textContent = label;
    const i = document.createElement("input");
    i.type = "checkbox";
    i.checked = checked;
    i.addEventListener("change", () => onChange(i.checked));
    row.append(l, i);
    return row;
  }

  /**
   * An MDI glyph via ha-icon, the frontend's own icon element. It is registered
   * early so it is reliably there; the text fallback exists only so a missing
   * element degrades to something visible rather than an empty box.
   */
  _icon(name, fallback) {
    if (customElements.get("ha-icon")) {
      const i = document.createElement("ha-icon");
      i.setAttribute("icon", name);
      i.setAttribute("aria-hidden", "true");
      return i;
    }
    const span = document.createElement("span");
    span.setAttribute("aria-hidden", "true");
    span.textContent = fallback;
    return span;
  }

  _button(label, icon, fallback, onClick, action) {
    const ha = this._field("ha-button") || this._field("mwc-button");
    if (ha) {
      ha.dataset.action = action;
      const glyph = this._icon(icon, fallback);
      glyph.slot = "icon";
      ha.appendChild(glyph);
      // The text has to be a child node, not a `label` property: ha-button is
      // Material-Web based and renders its default slot, so a label property is
      // silently ignored and the button comes out blank. A text node also works
      // for mwc-button, which renders slotted content after its own label.
      ha.appendChild(document.createTextNode(label));
      ha.addEventListener("click", onClick);
      return ha;
    }
    const b = document.createElement("button");
    b.className = "btn";
    b.type = "button";
    b.dataset.action = action;
    b.append(this._icon(icon, fallback));
    const text = document.createElement("span");
    text.textContent = label;
    b.appendChild(text);
    b.addEventListener("click", onClick);
    return b;
  }

  /** Icon-only, so the label carries the accessible name instead of the glyph. */
  _iconButton(label, icon, fallback, enabled, onClick, action, danger = false) {
    const ha = this._field("ha-icon-button");
    if (ha) {
      ha.dataset.action = action;
      ha.label = label;
      ha.disabled = !enabled;
      if (danger) ha.classList.add("danger");
      ha.appendChild(this._icon(icon, fallback));
      ha.addEventListener("click", onClick);
      return ha;
    }
    const b = document.createElement("button");
    b.className = "btn icon";
    b.type = "button";
    b.dataset.action = action;
    b.title = label;
    b.setAttribute("aria-label", label);
    if (danger) b.classList.add("danger");
    b.disabled = !enabled;
    b.append(this._icon(icon, fallback));
    b.addEventListener("click", onClick);
    return b;
  }
}

customElements.define("solar-bank-card", SolarBankCard);
customElements.define("solar-bank-card-editor", SolarBankCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "solar-bank-card",
  name: "Solar Bank Card",
  description: "Compact per-panel output grid for microinverter banks.",
  preview: true,
  documentationURL: "https://github.com/dgaust/solar-bank-card",
});
