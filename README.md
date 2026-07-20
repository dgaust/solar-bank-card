# Solar Bank Card

A compact Lovelace card for microinverter solar arrays. Instead of one card per
panel, each **bank** renders as a single row: name, live total, producing count,
and a tight grid of one cell per panel shaded by output.

An 18-panel array that used to take 18 cards fits in about the space of two.

Dependency-free plain custom element — no Lit, no CDN, no build step.

## Install

### HACS (recommended)

1. HACS → **⋮** → **Custom repositories**.
2. Add `https://github.com/dgaust/solar-bank-card` with type **Dashboard**.
3. Install **Solar Bank Card**, then reload your browser.

HACS adds the Lovelace resource for you. Updates then show up in HACS like any
other card.

### Manual

1. Copy `solar-bank-card.js` into your Home Assistant `config/www/` folder.
2. Add it as a Lovelace resource: **Settings → Dashboards → ⋮ → Resources →
   Add resource**, URL `/local/solar-bank-card.js`, type **JavaScript Module**.
3. Hard-refresh the browser and confirm the `SOLAR-BANK-CARD <version>` banner
   in the console.

## Configuration

The card ships a visual editor, so **Add card → Solar Bank Card** gives you a
form: add and name banks, add panels to them, reorder either with the arrows,
and set every option below. The YAML underneath stays minimal — an option left
at its default isn't written out.

Panels are chosen with Home Assistant's own entity picker — search by friendly
name, with icons and keyboard support like any other entity field. It lists
`sensor` entities with `device_class: power`, which is what a microinverter
reports, so the dropdown holds the handful of plausible entities rather than
every number in the house. An entity id can still be typed in by hand if a panel's
sensor lacks the device class.

```yaml
type: custom:solar-bank-card
title: Solar generation
max_value: 300
banks:
  - name: West
    entities:
      - sensor.inverter_122016007611_west
      - sensor.inverter_122016007612_west
  - name: East
    entities:
      - sensor.inverter_122016006491_east
      - sensor.inverter_122016007555_east
```

In a **sections** view the card can end up in a narrow column, which squeezes
the panels down to slivers. Wrapping it in a `vertical-stack` is the simplest
way to give it the full width — see
[`examples/power-view-section.yaml`](examples/power-view-section.yaml).

| Option            | Type   | Default | Description                                                    |
| ----------------- | ------ | ------- | -------------------------------------------------------------- |
| `banks`           | list   | —       | Required. Each bank has a `name` and an `entities` list.        |
| `max_value`       | number | `300`   | Per-panel output, in watts, that counts as a fully shaded cell.  |
| `title`           | string | —       | Optional card header.                                           |
| `show_values`     | bool   | `true`  | Print each panel's output, centred in its cell.                 |
| `color`           | string | —       | Theme colour name for the cell fill. Omit to follow the theme.  |
| `w_decimals`      | number | `0`     | Decimal places while the total reads in watts.                  |
| `kw_decimals`     | number | `1`     | Decimal places once it reads in kilowatts.                      |

Totals switch from W to kW at a kilowatt; that crossover isn't configurable. The
two decimal options are named and defaulted to match `power-flow-card-plus`, so
a dashboard carrying both cards can be made to agree by copying the values
across. They apply to the bank totals and to the per-cell hover text alike.

Entities are read in watts. A sensor whose `unit_of_measurement` is `kW` is
scaled automatically.

## Behaviour

- Cell shading is opacity over the theme's active-state colour, so it reads
  correctly in both light and dark themes. No hardcoded colours.
- Tap or keyboard-activate a cell to open that inverter's more-info dialog.
- An unavailable inverter gets a dashed outline and is counted separately in the
  bank header (`10/11 producing · 1 offline`), which makes a dead panel obvious
  without reading every value.
- Panels are laid out in config order, so listing them to match their physical
  arrangement on the roof makes the grid a rough map of the array.
- Every bank uses the widest bank's column count, so cells are the same size in
  each row and line up vertically. Banks of equal size fill the card width, which
  puts the last cell flush with the bank total above it.

### Colour

By default the cells use the theme's active-state colour, so the card matches
whatever the rest of the dashboard is doing. To override it, pick a colour in the
editor — it's Home Assistant's own colour picker, the same one behind the tile
card's Color option.

```yaml
type: custom:solar-bank-card
color: amber
banks: [...]
```

The value is a theme colour *name* (`amber`, `deep-orange`, `primary`, …), not a
hex code, so it resolves through `--<name>-color` and keeps following the theme
in both light and dark mode. Anything that isn't a plain colour name is ignored
and the card falls back to the theme.

The colour is a property of the card, not of a bank. Every bank shades the same
way, because the shading *is* the measurement — giving each bank its own hue
would put a second, meaningless variable on top of the one that carries the data.

### Cell labels

With `show_values` on (the default) each cell prints its own output, centred.
The label is the bare number — the unit lives on the bank total, and at nine
columns `265 W` crowds a cell in a way `265` does not. Hovering still gives the
fully formatted value with the panel's name.

Two things happen automatically, because a card can land in a stack, a section
or a popup and can't know its own width:

- The label colour flips to the theme's on-accent colour once a cell is at least
  half full, so it stays readable as the fill darkens.
- Labels hide themselves when a cell drops below 28px, rather than overflowing.
  With a very wide bank on a narrow card you get the plain heatmap back.

## Tests

`tests/card.test.mjs` drives the real class the way Home Assistant does and
asserts on the rendered DOM — no browser and no HA needed:

```bash
npm install --no-save jsdom
node tests/card.test.mjs
```

`tests/harness.html` is the visual counterpart: open it directly in a browser to
see the card at three widths with fake data, including an unavailable panel.

## Notes

Bank membership usually can't be derived from Home Assistant: microinverters
typically arrive with no area or device grouping, and serial number ranges don't
reliably follow roof faces. Assigning them is a manual job however you configure
the card.

The editor uses Home Assistant's own components — `ha-entity-picker`,
`ha-textfield`, `ha-switch`, `ha-icon-button`, `ha-button`, `ha-icon` — so it
looks and behaves like the rest of the frontend, and its sizes, weights and radii
come from HA design tokens rather than literals.

Each of those falls back to a native control if the element isn't registered
(`ha-entity-picker` → `ha-selector` → a text field with a `datalist`). Custom
elements are only defined once something in the frontend has pulled them in, and
an unresolved custom element renders as an invisible box — the fallbacks mean an
editor opened before they load stays usable instead of appearing blank.

## Licence

MIT
