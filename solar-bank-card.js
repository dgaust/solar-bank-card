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

const CARD_VERSION = "1.0.0";
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
      .bank-head {
        display: flex; align-items: baseline; gap: 8px;
        font-size: 14px; color: var(--secondary-text-color);
      }
      .bank-name { font-weight: 500; color: var(--primary-text-color); }
      .bank-total { margin-left: auto; font-variant-numeric: tabular-nums;
                    color: var(--primary-text-color); font-weight: 500; }
      .bank-count { font-size: 12px; }
      .grid { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
      .cell {
        position: relative; flex: 1 1 22px; min-width: 22px; max-width: 46px;
        aspect-ratio: 1; border-radius: 4px; cursor: pointer;
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
