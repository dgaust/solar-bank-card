# Solar Bank Card

A compact Lovelace card for microinverter solar arrays. Instead of one card per
panel, each **bank** renders as a single row: name, live total, producing count,
and a tight grid of one cell per panel shaded by output.

An 18-panel array that used to take 18 cards fits in about the space of two.

Dependency-free plain custom element — no Lit, no CDN, no build step.

## Install

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

Entity fields are type-to-filter, listing the `sensor` entities measured in W or
kW. Anything else can still be typed in by hand.

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
| `watt_threshold`  | number | `1000`  | Output at or above this switches the display from W to kW.      |
| `w_decimals`      | number | `0`     | Decimal places below the threshold.                             |
| `kw_decimals`     | number | `1`     | Decimal places above it.                                        |

The three formatting options are named and defaulted to match
`power-flow-card-plus`, so a dashboard carrying both cards can be made to agree
by copying the values across. They apply to the bank totals and to the per-cell
hover text alike.

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

The editor uses native inputs rather than `ha-entity-picker` and friends. Those
are only defined once something else in the frontend has pulled them in, so a
card reaching for them can render an empty editor depending on how the user got
there. A `datalist` gives the same type-to-filter behaviour with nothing to load,
which also keeps the card dependency-free.

## Licence

MIT
