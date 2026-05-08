# Cognigy Webchat Theme Builder

A single-page tool for visually customizing the look of a Cognigy webchat widget and generating a copy/paste-ready CSS snippet to drop into your site.

Edit colors, typography, shape, sizing, and shadow with live controls; preview the widget in real time; copy out a Cognigy-compatible stylesheet that includes both light and dark mode rules.

## Quick start

It's a single static HTML file — no build step, no dependencies.

```sh
open index.html
```

Or serve it from any static host. That's the whole setup.

## How to use it

1. **Pick a preset** (Modern / Minimal / Playful) as a starting point, or skip and tweak from the default.
2. **Toggle Day / Night** in the controls panel (or the top-right switch) to choose which mode you're editing. The preview reflects the mode being edited.
3. **Adjust controls** — colors via picker, radii and font size via slider, widget dimensions via number input, font and shadow via dropdown. Every change updates the preview and the generated snippet instantly.
4. **Pick an output mode** for the snippet: Day only, Night only, or Both.
5. **Copy** the snippet and paste it into your Cognigy webchat custom CSS field.

Your in-progress theme is autosaved to `localStorage`, so a refresh won't lose your work. **Reset** clears storage and reloads the Modern preset.

## What the generated CSS looks like

The snippet emits **per-class rules** wrapped in the Cognigy specificity selector — not CSS variable assignments — because the Cognigy webchat's internal stylesheet doesn't reference these tokens by name. Example:

```css
[data-cognigy-webchat-root] [data-cognigy-webchat].webchat .webchat-header-bar {
  background-color: #1C1B18;
}

@media (prefers-color-scheme: dark) {
  [data-cognigy-webchat-root] [data-cognigy-webchat].webchat .webchat-header-bar {
    background-color: #111110;
  }
}
```

When "Both" output mode is selected, dark mode is delivered via `@media (prefers-color-scheme: dark)` — **no JavaScript is required** on the host site. The browser switches automatically based on the user's OS preference.

The toggle/FAB uses the separate `[data-cognigy-webchat-toggle]` parent selector required by Cognigy.

## Controls

| Group | Controls |
|---|---|
| **Colors** | Accent, demo page background (preview only), chat background, header background, bot bubble, user bubble, input field, unread badge, toggle (FAB) |
| **Typography** | Font family (curated list), message text size |
| **Shape** | Chat container radius, bubble radius, input radius, toggle (FAB) radius |
| **Sizing** | Widget width, widget height |
| **Effect** | Drop shadow (None / Soft / Strong) |

The demo page background controls the preview backdrop only — it's not part of the widget and is excluded from the snippet.

## Project layout

```
index.html      Everything: markup, styles, controls, generator, preview
README.md       This file
```

Single file by design — the tool is small enough that a build step would add more friction than value.

## How it's wired

- The right-side preview is driven by CSS variables on `:root` and `[data-theme="night"]`.
- Two `<style>` elements (`#day-overrides` and `#night-overrides`) are populated by JS as you edit, overriding the defaults via source order.
- The snippet generator is independent: it maps each design token to one or more `{ selector, property }` targets and emits concrete per-class rules with the Cognigy parent selectors prefixed.

## Customizing further

To add a new design token, edit `TOKEN_DEFS` in [index.html](index.html):

```js
myNewToken: {
  label: 'My new token', type: 'color', group: 'Colors',
  cssVar: '--my-new-var',                       // drives the preview
  snippet: [                                    // drives the generated CSS
    { sel: `${SEL_ROOT} .some-cognigy-class`, prop: 'background-color' },
  ],
},
```

Then add a default value to each preset in `PRESETS`. The control will appear in the panel automatically.
