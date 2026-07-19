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

const CARD_VERSION = "1.1.0";
console.info(`%c SOLAR-BANK-CARD ${CARD_VERSION} `, "background:#f6a800;color:#000");

const DEFAULT_MAX = 300; // W per panel at full output
const IDLE_W = 1; // below this a panel counts as asleep

class SolarBankCard extends HTMLElement {
  setConfig(config) {
    if (!config || !Array.isArray(config.banks) || !config.banks.length) {
      throw new Error("solar-bank-card: `banks` must be a non-empty list");
    }
    config.banks.forEach((b, i) => {
      if (!Array.isArray(b.entities) || !b.entities.length) {
        throw new Error(`solar-bank-card: bank ${i + 1} needs an \`entities\` list`);
      }
    });
    this._config = config;
    this._sig = null;
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
   * Sections views hand an unknown custom card a narrow default column, which
   * squeezes the panel grid into a couple of cells per row and wraps the header.
   * A bank only reads as a bank when its panels sit on one line, so ask for the
   * full section width and set a floor well above the default.
   */
  getGridOptions() {
    const widest = Math.max(...this._config.banks.map((b) => b.entities.length));
    return {
      columns: "full",
      rows: "auto",
      min_columns: Math.min(12, Math.max(6, Math.ceil(widest / 2))),
    };
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
        font-size: 14px; color: var(--secondary-text-color);
      }
      .bank-name {
        font-weight: 500; color: var(--primary-text-color);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .bank-total { margin-left: auto; font-variant-numeric: tabular-nums;
                    color: var(--primary-text-color); font-weight: 500;
                    white-space: nowrap; flex: 0 0 auto; }
      .bank-count { font-size: 12px; white-space: nowrap; min-width: 0;
                    overflow: hidden; text-overflow: ellipsis; }
      /* Exactly one row per bank, always. A fixed column count (set inline per
         bank) rather than auto-fit is what makes two equal-sized banks line up
         cell-for-cell, so comparing east against west is a vertical glance.
         Cells cap at 46px and shrink below it on a narrow card. */
      .grid { display: grid; gap: 4px; margin-top: 6px; justify-content: start; }
      .cell {
        position: relative; aspect-ratio: 1; border-radius: 4px; cursor: pointer;
        background: var(--divider-color);
        transition: background-color 240ms ease-out;
      }
      .cell .fill {
        position: absolute; inset: 0; border-radius: 4px;
        background: var(--state-icon-active-color, var(--primary-color));
        opacity: 0; transition: opacity 240ms ease-out;
      }
      .cell.dead { outline: 1px dashed var(--error-color); outline-offset: -1px; }
      .cell:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 1px; }
    `;

    const wrap = document.createElement("div");
    wrap.className = "wrap";
    this._cells = [];

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
      grid.style.gridTemplateColumns = `repeat(${bank.entities.length}, minmax(0, 46px))`;

      const cells = bank.entities.map((id) => {
        const cell = document.createElement("div");
        cell.className = "cell";
        cell.tabIndex = 0;
        cell.setAttribute("role", "button");
        const fill = document.createElement("div");
        fill.className = "fill";
        cell.appendChild(fill);
        const open = () => this._moreInfo(id);
        cell.addEventListener("click", open);
        cell.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open();
          }
        });
        grid.appendChild(cell);
        return { id, cell, fill };
      });

      sec.append(head, grid);
      wrap.appendChild(sec);
      this._cells.push({ bank, cells, count, total });
    });

    card.append(style, wrap);
    this.appendChild(card);
  }

  _update() {
    const max = this._config.max_value || DEFAULT_MAX;

    this._cells.forEach(({ bank, cells, count, total }) => {
      let sum = 0;
      let live = 0;
      let unknown = 0;

      cells.forEach(({ id, cell, fill }) => {
        const w = this._watts(id);
        if (w === null) {
          unknown += 1;
          cell.classList.add("dead");
          fill.style.opacity = 0;
          cell.title = `${id}: unavailable`;
          return;
        }
        cell.classList.remove("dead");
        sum += w;
        if (w >= IDLE_W) live += 1;
        // Opacity carries the magnitude; the hue stays the theme's active
        // colour so this reads correctly in light and dark themes.
        const frac = Math.max(0, Math.min(1, w / max));
        fill.style.opacity = frac === 0 ? 0 : 0.15 + frac * 0.85;
        const nm = this._hass.states[id].attributes.friendly_name || id;
        cell.title = `${nm}: ${w.toFixed(0)} W`;
      });

      const n = cells.length;
      count.textContent = unknown
        ? `${live}/${n} producing · ${unknown} offline`
        : `${live}/${n} producing`;
      total.textContent = sum >= 1000 ? `${(sum / 1000).toFixed(2)} kW` : `${sum.toFixed(0)} W`;
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

  static getStubConfig() {
    return { title: "Solar Generation", banks: [{ name: "Bank A", entities: [] }] };
  }
}

customElements.define("solar-bank-card", SolarBankCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "solar-bank-card",
  name: "Solar Bank Card",
  description: "Compact per-panel output grid for microinverter banks.",
});
