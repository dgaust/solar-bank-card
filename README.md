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

```yaml
type: custom:solar-bank-card
title: Solar generation
max_value: 300
banks:
  - name: West
    entities:
      - sensor.inverter_122016007611
      - sensor.inverter_122016007612
  - name: East
    entities:
      - sensor.inverter_122016006491
      - sensor.inverter_122016007555
```

| Option      | Type   | Default | Description                                                        |
| ----------- | ------ | ------- | ------------------------------------------------------------------ |
| `banks`     | list   | —       | Required. Each bank has a `name` and an `entities` list.            |
| `max_value` | number | `300`   | Per-panel output, in watts, that counts as a fully shaded cell.     |
| `title`     | string | —       | Optional card header.                                               |

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

## Notes

There is no editor UI — configure it in YAML. Bank membership usually can't be
derived from Home Assistant, since microinverters typically arrive with no area
or device grouping and serial number ranges don't reliably follow roof faces.

## Licence

MIT
