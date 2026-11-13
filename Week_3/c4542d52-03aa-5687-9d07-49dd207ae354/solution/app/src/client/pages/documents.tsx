import { useEffect, useState } from "react";
import type { Document } from "../../shared/types.js";
import { displayInstant } from "../../shared/format.js";
import { ApiFailure, documentText } from "../api.js";
import { useResource } from "../hooks.js";
import { Link, goBackOr, requestFocus } from "../router.js";
import { useSession } from "../session.js";
import { Band, Dialog, SealedMark } from "../ui.js";
import { NotFoundPage } from "./notFound.js";

const KIND_LABEL = { grant_agreement: "Grant agreement", exercise_notice: "Exercise notice", tender_nda: "Tender NDA" } as const;
const linkSelector = (id: string) => `[data-document="${id}"]`;

export function DocumentsPage({ openId }: { openId: string | null }) {
  const { person } = useSession();
  const documents = useResource<{ documents: Document[] }>("/api/documents", ["documents"]);
  const selected = openId ? documents.data?.documents.find((document) => document.id === openId) : undefined;

  if (openId && documents.data && !selected) return <NotFoundPage />;
  return (
    <main className={documents.data?.documents.length === 0 ? "chapter chapter-empty" : "chapter"}>
      <section className="sheet">
        <p className="note">{person.name}</p>
        <h1 tabIndex={-1}>Documents</h1>
      </section>
      {documents.data && documents.data.documents.length === 0 && (
        <Band tone="black" className="band-fill-inner">
          No documents yet.
        </Band>
      )}
      {documents.data && documents.data.documents.length > 0 && (
        <section className="sheet">
          <p className="note">Each document is sealed in the vault; its seal is a SHA-256 hash.</p>
          <ul role="list" aria-label="Documents" className="rows">
            {documents.data.documents.map((document) => (
              <li key={document.id} className="row-item">
                <Link href={`/documents/${document.id}`} data-document={document.id} returnFocus={linkSelector(document.id)}>
                  {document.title}
                </Link>
                <span>{KIND_LABEL[document.kind]}</span>
                <span className="sealed-state">{document.status === "sealed" && <SealedMark />}{document.status === "sealed" ? "Sealed" : "Pending"}</span>
                <span className="seal">Seal {document.sha256.slice(0, 12)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {selected && <DocumentViewer document={selected} />}
    </main>
  );
}

function DocumentViewer({ document }: { document: Document }) {
  const [text, setText] = useState<string>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setText(undefined);
    setFailed(false);
    documentText(document.id)
      .then(setText)
      .catch((failure: unknown) => {
        if (!(failure instanceof ApiFailure)) throw failure;
        setFailed(true);
      });
  }, [document.id, document.status]);

  const close = () => {
    goBackOr("/documents");
    requestFocus(linkSelector(document.id));
  };

  return (
    <Dialog title="Document viewer" onClose={close} returnSelector={linkSelector(document.id)}>
      <h3 className="viewer-title">{document.title}</h3>
      {failed && <Band tone="red">The document vault can't be reached. Try again shortly.</Band>}
      {!failed && text === undefined && <Band tone="black">Opening the document.</Band>}
      {text !== undefined && <pre className="document-text">{text}</pre>}
      <p className="viewer-meta">Seal {document.sha256.slice(0, 12)}</p>
      <p className="viewer-meta">Version {document.version}</p>
      {document.supersedes && <p className="viewer-meta">Corrects {document.supersedes}</p>}
      {document.superseded_by && <p className="viewer-meta">Superseded by {document.superseded_by}</p>}
      <p className="viewer-meta">Created {displayInstant(document.created_at)}</p>
      <div className="actions">
        <button type="button" data-autofocus className="button button-secondary" onClick={close}>
          Close
        </button>
      </div>
    </Dialog>
  );
}

