# client/chart: the SVG view, the data table twin and Mark details

Import from the barrel: `import { ChartView, DataTable, MarkDetails } from '../../chart/index.ts'` (types `MarkInfo`,
`ChartViewProps`, `DataTableProps`, `MarkDetailsProps` come from the same file). The props are the ones in `props.ts`.
Everything below is what each export does and what the caller must do. No hooks are exported: selection, focus, the
tooltip, the width and Mark Glide live inside `ChartView`.

## `ChartView`

One white-card-friendly block: the scrollable SVG (`svg` named after `sheetName`), a tooltip while shown and `list "Legend"`.
It draws `layoutChart(sheet, result, size, { touch, compact })` from `shared/chart`; it never decides geometry.

- The page owns `region "View"`, the empty headline `Place a field on Rows or Columns.` (when `result.chart === 'none'`
  `ChartView` renders nothing) and the notices. Pass the last good `result`, a stable object: **Mark Glide runs when the
  `result` object changes** (same `data-mark` before and after: one `mark-glide` animation, 240 ms), not on resize or
  re-render.
- Width comes from the container (ResizeObserver). Give the parent a definite width; the SVG never exceeds it unless tap
  targets need the room, then the chart block scrolls inside itself, never the page.
- Optional extra prop `height?: number`: a requested height in px (dashboard objects); omitted, the chart picks its own.
- `touch`: `true` below 768 (`usePhone()` from `client/ui/phone.ts`). A click on a mark then reports `onSelect(info)` and
  `onTap(info)`; open `MarkDetails` from `onTap`.
- `compact`: dashboards and phones.
- `dimmed`: set of `data-mark` ids drawn dimmed (`data-dim="true"`).
- Selection: the chart keeps `aria-pressed` itself. Enter, Space or a click selects (`onSelect(info)`); Escape on a
  mark, or a click on empty plot space, clears it and calls `onSelect(null)`.
- Keyboard: roving tab stop, arrows move in mark order and stop at the ends; focus or real mouse hover shows the one
  tooltip; Escape or leaving hides it.
- DOM contract: `[data-mark]` is one `<g role="button">` per mark and nothing else carries `data-mark`; `[data-plot]` the
  plot rect; `[data-tick]` the value-axis labels; `[data-ref]` the reference lines.

```tsx
<ChartView sheetName={sheet.name} sheet={shape} result={result} touch={phone} compact={phone}
  dimmed={dimmed} onSelect={(mark) => runActions(mark)} onTap={setTapped} />
<MarkDetails mark={tapped} onClose={() => setTapped(null)} />
```

## `DataTable`

`grid "{sheetName} table"` from `buildTwin(sheet, result)` inside the shared `TableWrap` (a white card that scrolls
sideways inside itself). The page owns `region "Data table"` and, on dashboards, the `button "Table for ..."` toggle.
`highlighted` is the set of `data-mark` ids whose mark rows get `data-highlight="true"`.

## `MarkDetails`

`dialog "Mark details"` as a bottom sheet (`data-sheet="bottom"`, one `sheet-open` animation, none under reduced
motion) showing `mark.tooltip`. It renders nothing while `mark` is null. Closing (Escape, Close, outside click) calls
`onClose` and focus returns to the mark that was tapped, because `ChartView` focuses the mark on click first.

## Styles

`chart.css` is imported by the components; the chart is drawn in ink on the surface, so it assumes a white card behind it.
