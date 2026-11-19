import { Fragment } from "react";
import { displayDate } from "../../shared/text";

const TOKEN = /(?<=^|\s)([#@][\p{L}\p{N}_-]+)|!\((\d{4}-\d{2}-\d{2})\)/gu;

/**
 * The text of a bullet with its tags, mentions and date shown as grey chips.
 * `drawn` paints each piece with CSS `content` (the `data-t` attribute) instead of text nodes: a tree row
 * already carries its text in its treeitem name and its textbox, and the group of children nested inside a
 * row must not add their words to the row's visible text. A chip keeps its label as a real, transparent text
 * node under the painted one, so the label (the date in its display form) is still in the row's text.
 */
export function RichText({ text, date, drawn = false }: { text: string; date: string | null; drawn?: boolean }) {
  const plain = (key: string, value: string) => (drawn ? <span key={key} data-t={value} /> : <Fragment key={key}>{value}</Fragment>);
  const parts: React.ReactNode[] = [];
  let last = 0;
  let dated = false;
  for (const match of text.matchAll(TOKEN)) {
    const at = match.index ?? 0;
    const isDate = match[2] !== undefined;
    if (isDate && (dated || match[2] !== date)) continue;
    if (isDate) dated = true;
    if (at > last) parts.push(plain(`t${last}`, text.slice(last, at)));
    const label = isDate ? displayDate(match[2] ?? "") : match[1] ?? "";
    parts.push(drawn
      ? <span className="chip" key={`c${at}`} data-t={label}><span className="chip-text">{label}</span></span>
      : <span className="chip" key={`c${at}`}>{label}</span>);
    last = at + match[0].length;
  }
  if (last < text.length) parts.push(plain(`t${last}`, text.slice(last)));
  return <>{parts}</>;
}
