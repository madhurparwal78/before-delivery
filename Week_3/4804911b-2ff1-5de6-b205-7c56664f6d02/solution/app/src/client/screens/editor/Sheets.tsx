import { useState } from "preact/hooks";
import { COPY } from "../../../shared/copy";
import type { Draft, Sheet } from "../../../shared/types";
import { Icon } from "../../lib/icons";
import type { Links } from "../../lib/links";
import { messageOf, post } from "../../lib/net";

/** Sheets on file with their evidence link and SHA-256, and the one shared drafting form. */
export function Sheets({ sheets, links, say, onDraft }: { sheets: Sheet[] | null; links: Links; say: (message: string) => void; onDraft: (draft: Draft) => void }) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const draft = async (sheet: Sheet) => {
    if (busy) return;
    setBusy(true);
    say("Drafting from the sheet.");
    try {
      const made = await post<Draft>(`/api/editor/price-sheets/${sheet.id}/draft`, { title, effectiveDate: date, runOutUntil: null });
      say("Draft created from the sheet.");
      setTitle("");
      setDate("");
      onDraft(made);
    } catch (error) {
      say(messageOf(error, COPY.unavailable));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section class="sheets" aria-label="Sheets on file">
      <h2>Sheets on file</h2>
      <div class="block">
        <label for="draft-title">Draft title</label>
        <input id="draft-title" type="text" value={title} onInput={(e) => setTitle((e.currentTarget as HTMLInputElement).value)} />
        <label for="draft-date">Draft effective date</label>
        <input id="draft-date" type="text" inputMode="numeric" value={date} onInput={(e) => setDate((e.currentTarget as HTMLInputElement).value)} />
      </div>
      <ul role="list" class="sheet-list">
        {[...(sheets ?? [])].reverse().map((s) => {
          const url = links.url(`sheet-${s.id}`);
          const open = s.counts.ambiguous + s.counts.unmatched;
          return (
            <li key={s.id} class="sheet">
              <p class="wrap">{s.filename}</p>
              <p class="wrap sha">SHA-256 {s.sha256}</p>
              {url ? (
                <a class="rect-button small pdf-link wrap" href={url} data-link-key={`sheet-${s.id}`} data-keep={`sheet-link-${s.id}`} aria-label={`Download sheet ${s.filename}`}>
                  <Icon name="download" size={18} />
                  <span aria-hidden="true">Download sheet</span>
                </a>
              ) : (
                <p class="pdf-note">{links.sentence}</p>
              )}
              <button type="button" class="rect-button small wrap" data-keep={`draft-from-${s.id}`} disabled={open > 0} aria-label={`Draft notice from sheet ${s.filename}`} onClick={() => void draft(s)}>
                <span aria-hidden="true">Draft notice from sheet</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
