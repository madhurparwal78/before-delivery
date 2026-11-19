import { useState } from "react";
import { EMBED_TABS, type EmbedTab, type Pen } from "../../shared/types.js";
import { useDialog } from "../use-dialog.js";

const LABEL: Record<EmbedTab, string> = { html: "HTML", css: "CSS", js: "JS", result: "Result" };

const PUBLIC_URL = document.querySelector<HTMLMetaElement>('meta[name="ashlar-public-url"]')!.content;

const escapeAttribute =(text: string): string => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function ShareDialog({ open, onClose, pen }: { open: boolean; onClose: () => void; pen: Pen }): React.JSX.Element {
  const [tab, setTab] = useState<EmbedTab>("result");
  const [status, setStatus] = useState("");
  const dialog = useDialog(open, onClose, (element) => element.querySelector<HTMLElement>("input[name=starting-tab]:checked"));
  const link = `${PUBLIC_URL}/embed/${pen.id}?tab=${tab}`;
  const code = `<iframe src="${link}" title="${escapeAttribute(pen.title)} on Ashlar" width="100%" height="400"></iframe>`;

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(link);
      setStatus("Link copied");
    } catch {
      setStatus("Copying is not available here. Select the link and copy it by hand.");
    }
  };

  return (
    <dialog ref={dialog.ref} aria-labelledby="share-title" className="dialog" {...dialog.props}>
      <h2 id="share-title">Share</h2>
      {pen.visibility === "private" && (
        <p className="panel">This pen is private, so the embed shows a not-found page. Make it unlisted or public to embed it.</p>
      )}
      <div role="radiogroup" aria-label="Starting tab" className="choice-group">
        {EMBED_TABS.map((name) => (
          <label key={name} className="choice">
            <input type="radio" name="starting-tab" checked={tab === name} onChange={() => setTab(name)} />
            <span>{LABEL[name]}</span>
          </label>
        ))}
      </div>
      <label htmlFor="embed-link" className="field-label">
        Embed link
      </label>
      <input id="embed-link" type="text" readOnly value={link} />
      <label htmlFor="embed-code" className="field-label">
        Embed code
      </label>
      <input id="embed-code" type="text" readOnly value={code} />
      <p role="status" aria-label="Share status" className="status-line">
        {status}
      </p>
      <div className="dialog-actions">
        <button type="button" className="button primary" onClick={() => void copy()}>
          Copy link
        </button>
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </div>
    </dialog>
  );
}
