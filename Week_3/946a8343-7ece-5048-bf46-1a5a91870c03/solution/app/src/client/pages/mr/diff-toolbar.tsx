// The strip above the diff: the two views, the versions to compare (kept in the address) and `Finish review`.
import type { Ref } from "preact";
import { setQuery } from "../../router.ts";
import { Button } from "../../ui/button.tsx";
import { Select } from "../../ui/fields.tsx";
import type { Compare } from "./diff-data.ts";
import type { ViewMode } from "./diff-types.ts";

interface DiffToolbarProps {
  view: ViewMode;
  compare: Compare;
  /** Comments in the review in progress; the finish button shows while there are any. */
  pending: number;
  finishRef: Ref<HTMLButtonElement>;
  onFinish(): void;
}

export function DiffToolbar({ view, compare, pending, finishRef, onFinish }: DiffToolbarProps) {
  const { from, to, versions } = compare;
  const fromOptions = [
    { value: "target", label: "Target branch" },
    ...versions.filter((version) => to !== null && version.number < to).map((version) => ({ value: String(version.number), label: `Version ${version.number}` })),
  ];
  const toOptions = versions.map((version) => ({ value: String(version.number), label: `Version ${version.number}` }));
  return (
    <div class="sp-diff-bar">
      <div class="sp-diff-bar__views" role="group" aria-label="Diff view">
        <Button variant={view === "inline" ? "primary" : "secondary"} aria-pressed={view === "inline" ? "true" : "false"} onClick={() => setQuery({ view: "inline" })}>
          Inline view
        </Button>
        <Button variant={view === "split" ? "primary" : "secondary"} aria-pressed={view === "split" ? "true" : "false"} onClick={() => setQuery({ view: "split" })}>
          Side-by-side view
        </Button>
      </div>
      <div class="sp-diff-bar__versions">
        <Select
          label="Compare from"
          name="compare-from"
          options={fromOptions}
          value={String(from)}
          onChange={(event) => setQuery({ from: event.currentTarget.value, to })}
        />
        <Select
          label="Compare to"
          name="compare-to"
          options={toOptions}
          value={to === null ? "" : String(to)}
          onChange={(event) => {
            const chosen = Number(event.currentTarget.value);
            setQuery({ to: chosen, from: typeof from === "number" && from < chosen ? from : "target" });
          }}
        />
      </div>
      {pending > 0 ? (
        <Button innerRef={finishRef} variant="secondary" onClick={onFinish}>
          Finish review
        </Button>
      ) : null}
    </div>
  );
}
