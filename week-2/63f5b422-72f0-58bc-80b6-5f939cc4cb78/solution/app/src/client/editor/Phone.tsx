import { Dialog } from "../ui/Dialog.js";
import { Icon } from "../ui/icons.js";
import { useEditor, type PhoneSheet } from "./context.js";
import { CommentsBody } from "./panels/Comments.js";
import { PublishBody } from "./panels/Sheet.js";

const TITLE: Record<Exclude<PhoneSheet, null>, string> = { comments: "Comments", pages: "Pages", publish: "Publish status" };

function SheetDialog({ sheet }: { sheet: Exclude<PhoneSheet, null> }) {
  const { state, act } = useEditor();
  const close = () => act.setPhoneSheet(null);
  const pages = [...state.doc.pages].sort((a, b) => a.order - b.order);
  return (
    <Dialog label={TITLE[sheet]} onDismiss={close} className="pl-bottom-sheet">
      <div className="pl-panel-head">
        <h2 className="pl-panel-title">{TITLE[sheet]}</h2>
        <button type="button" className="pl-icon-button" aria-label={`Close ${TITLE[sheet]}`} onClick={close}>
          <Icon name="x" />
        </button>
      </div>
      <div className="pl-sheet-body">
        {sheet === "comments" && <CommentsBody />}
        {sheet === "pages" && (
          <ul className="pl-page-links">
            {pages.map((p) => (
              <li key={p.id}>
                <a
                  href={`/w/${state.workspaceId}/edit?page=${p.id}`}
                  aria-current={p.id === state.page.id ? "page" : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    act.setPage(p.id);
                    close();
                  }}
                >
                  {p.name}
                </a>
              </li>
            ))}
          </ul>
        )}
        {sheet === "publish" && <PublishBody readOnly />}
      </div>
    </Dialog>
  );
}

/** Below 768 px: preview and comment only, with three tools at the bottom. */
export function PhoneToolbar() {
  const { state, act } = useEditor();
  return (
    <>
      <div role="toolbar" aria-label="Preview tools" className="pl-phone-toolbar">
        <button type="button" className="pl-phone-tool" onClick={() => act.setPhoneSheet("comments")}>
          <Icon name="message-square" />
          Comments
        </button>
        <button type="button" className="pl-phone-tool" onClick={() => act.setPhoneSheet("pages")}>
          <Icon name="file-text" />
          Pages
        </button>
        <button type="button" className="pl-phone-tool" onClick={() => act.setPhoneSheet("publish")}>
          <Icon name="globe" />
          Publish status
        </button>
      </div>
      {state.phoneSheet && <SheetDialog sheet={state.phoneSheet} />}
    </>
  );
}
