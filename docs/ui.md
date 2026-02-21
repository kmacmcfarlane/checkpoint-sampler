# UI Architecture

This document defines the frontend UI framework, theming, layout patterns, and component conventions for Checkpoint Sampler.

## 1) Component library

The frontend uses [Naive UI](https://www.naiveui.com/) (`naive-ui`) as its Vue 3 component library. Naive UI provides:

- Pre-built components (buttons, selects, checkboxes, sliders, drawers, modals, tables, etc.)
- Built-in dark/light theme system via `NConfigProvider`
- TypeScript support
- Tree-shakeable imports

All UI elements should use Naive UI components instead of custom HTML elements with manual styling.

## 2) Theming

### 2.1 Theme modes

Two theme modes are supported:

- **Light** — default Naive UI light theme
- **Dark** — default Naive UI dark theme

A 2-way toggle (Light / Dark) is provided in the application header. The initial default is determined by the browser's `prefers-color-scheme` media query.

### 2.2 Persistence

The selected theme is persisted in `localStorage` (key: `theme`). On load:

1. Check `localStorage` for a saved theme preference.
2. If none saved, read `window.matchMedia('(prefers-color-scheme: dark)')`.
3. Apply the resolved theme via `NConfigProvider`'s `theme` prop.

### 2.3 Custom theming

Any custom styles beyond Naive UI defaults should use Naive UI's theme override system (`themeOverrides` prop on `NConfigProvider`) rather than hardcoded CSS colors. This ensures consistency across light and dark modes.

## 3) Application layout

### 3.1 Structure

```
┌──────────────────────────────────────────────────────────┐
│  Header: [☰ Toggle]  [App Title]  [Theme] [WS Status]   │
├──────────────────────────────────────────────────────────┤
│  ┌─────────────┐  Main Content:                          │
│  │  Left Drawer │  ┌──────────────────────────────────┐  │
│  │  (overlay)   │  │  Dimension Filters (collapsible) │  │
│  │              │  ├──────────────────────────────────┤  │
│  │  Training    │  │  Master Slider (full width)      │  │
│  │  Run Picker  │  ├──────────────────────────────────┤  │
│  │              │  │  X/Y Image Grid                  │  │
│  │  Preset      │  │  (scrolls with page)             │  │
│  │  Picker      │  │                                  │  │
│  │              │  └──────────────────────────────────┘  │
│  │  Dimension   │                                        │
│  │  Assignments │  Checkpoint Metadata (right drawer,    │
│  │              │  resizable)                             │
│  └─────────────┘                                         │
└──────────────────────────────────────────────────────────┘
```

### 3.2 Left drawer (controls panel)

- Uses Naive UI `NDrawer` component, opens from the left.
- **Overlay mode**: does not push main content; floats on top.
- Contains (top to bottom): Training Run Picker, Preset Picker, Dimension Assignments.
- **Responsive default**: open by default on wide screens (≥1024px), closed on narrow screens.
- Toggle via a hamburger button in the header.

### 3.3 Main content area

- Dimension filters (collapsible, above the grid).
- Master slider (full width, inline with Play button). **Sticky**: the slider is `position: sticky; top: 0` so it remains visible at all times, even when the grid overflows the viewport.
- X/Y image grid fills the remaining viewport space. The page scrolls as a whole (no independent grid overflow), but the slider stays pinned at the top.

### 3.4 Right drawer (checkpoint metadata)

- Uses Naive UI `NDrawer` or a custom resizable panel.
- Resizable by dragging the left edge.
- Width constraints: min 300px, max 80vw.
- Full width at the smallest responsive breakpoint.

## 4) Dimension filters

### 4.1 Filter modes

Each dimension has a filter mode that determines how its values are presented:

| Mode | Component | Behavior |
|------|-----------|----------|
| **Hide** | (none) | No filter UI rendered. All values included. |
| **Single** | `NSelect` or `NRadioGroup` | Exactly one value active. |
| **Multi** | `NCheckboxGroup` | Multiple values selectable. Solo/unsolo via label click. |

### 4.2 Mode assignment rules

- Dimensions assigned to X, Y, or Slider role → Multi filter mode (implicit, not changeable).
- Unassigned dimensions → default to Hide; user can change to Single or Multi.

### 4.3 Interaction behaviors

**Multi mode:**
- Click a value label → select only that value (solo).
- Click the label of the only selected value → re-select all values (unsolo).
- Select-all / select-none controls available.

**Single mode:**
- When switching from Multi → Single, defaults to the first previously-selected value. If no previous selection, defaults to the first value.
- No solo/unsolo behavior (only one value can be selected).

### 4.4 Collapsed by default

Dimension filters in the main content area are collapsed by default. Each filter has an expand/collapse toggle (down-arrow icon).

## 5) Grid

### 5.1 Scrolling and viewport usage

The image grid does not have independent overflow. The entire page scrolls together (no `max-height` or `overflow: auto` on the grid container). The grid uses the full viewport width and height, minus a small spacer at the top for the sticky master slider. When the grid is larger than the viewport (e.g. due to cell resizing or many dimension values), the page scrolls but the master slider remains pinned at the top of the viewport.

### 5.2 Cell resizing

Grid cell boundaries are resizable by dragging dividers:

- **Vertical dividers** (between columns): all column widths change together.
- **Horizontal dividers** (between rows): all row heights change together.

### 5.3 Header click filtering

- Clicking an X-axis column header solos that value in the X dimension's filter (selects only that value).
- Clicking the header when it's already soloed re-selects all values for that dimension.
- Same behavior for Y-axis row headers.
- This works because X/Y dimensions always have Multi filter mode.

## 6) Master slider

- Full width (100% of the main content area).
- **Always visible**: uses `position: sticky; top: 0` with a high enough `z-index` to stay pinned above the grid as the page scrolls. When scrolled to the top of the page, the slider sits in its natural layout position (below filters, above grid).
- Play button is inline with the slider (stacks vertically on small mobile screens).
- Pressing Play:
  - Starts playback.
  - Reveals loop controls (loop checkbox + speed selector) inline.
- Stopping playback hides the loop controls.
- Loop is enabled by default.
- Speed options: 0.25s, 0.33s, 0.5s, 1s (default), 2s, 3s.

## 7) Image lightbox

- Clicking the background (backdrop) closes the lightbox.
- An X button in the top-left corner provides an explicit close action.
- Escape key closes the lightbox.
- Zoom (mouse wheel) and pan (click-drag) are preserved.
- Generation metadata panel does not interfere with zoom/pan.

## 8) Checkpoint metadata panel

- Stacked key-value layout: each metadata field renders as a key header above its value (not a side-by-side table).
- Resizable by dragging the left edge.
- Width constraints: min 300px, max 80vw.
- Full width at the smallest responsive breakpoint.

## 9) Responsive breakpoints

| Breakpoint | Width | Behavior |
|------------|-------|----------|
| **Mobile** | < 768px | Left drawer closed by default; master slider stacks controls vertically; checkpoint metadata panel full width |
| **Tablet** | 768px–1023px | Left drawer closed by default |
| **Desktop** | ≥ 1024px | Left drawer open by default |
