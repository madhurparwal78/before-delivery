import { useRef, useState } from "react";
import { Modal } from "../components/Modal.tsx";
import { DistrictTotals, Page } from "../components/Shell.tsx";
import { api, usePoll } from "../lib.ts";
import type { User } from "../types.ts";

interface Contractor {
  code: string;
  name: string | null;
  phone: string | null;
  erased: boolean;
}

export function Contractors({ user }: { user: User }) {
  const contractors = usePoll(() => api<{ contractors: Contractor[] }>("/api/contractors"), []);
  const [erasing, setErasing] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const cancelRef = useRef<HTMLButtonElement>(null);
  const clerk = user.role === "clerk";

  const erase = async (code: string) => {
    setErasing(null);
    setStatus("Erasing.");
    const reply = await api(`/api/contractors/${encodeURIComponent(code)}`, { method: "DELETE" });
    setStatus(reply.ok ? `Contractor ${code} erased. Their deliveries now show only the operator code.` : reply.error.message ?? "");
    contractors.reload();
  };

  return (
    <Page title="Contractors" lead={<DistrictTotals />}>
      <p className="muted">Hired gate workers. Erasing removes a contractor's name, phone and sign-in; their strokes keep the operator code.</p>
      <table className="table" aria-label="Contractors">
        <thead>
          <tr><th scope="col">Code</th><th scope="col">Name</th><th scope="col">Phone</th><th scope="col">State</th>{clerk && <th scope="col"><span className="visually-hidden">Action</span></th>}</tr>
        </thead>
        <tbody>
          {(contractors.data?.contractors ?? []).map((c) => (
            <tr key={c.code}>
              <td data-label="Code" className="strong">{c.code}</td>
              <td data-label="Name">{c.erased ? `Operator ${c.code}` : c.name}</td>
              <td data-label="Phone" className="num">{c.erased ? "" : c.phone}</td>
              <td data-label="State">{c.erased ? <span className="badge">Erased</span> : <span className="badge">Active</span>}</td>
              {clerk && (
                <td data-label="Action">
                  {/* An erased row keeps its button, disabled to assistive technology and still focusable. */}
                  <button
                    ref={(el) => {
                      if (el) buttons.current.set(c.code, el);
                    }}
                    type="button"
                    className="btn btn-quiet btn-small"
                    aria-label={`Erase ${c.code}`}
                    aria-disabled={c.erased || undefined}
                    onClick={() => {
                      if (!c.erased) setErasing(c.code);
                    }}
                  >
                    Erase
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <p role="status" aria-label="Contractor status" className="status-line">{status}</p>
      {erasing && (
        <Modal
          role="alertdialog"
          labelledBy="erase-heading"
          returnFocus={{ current: buttons.current.get(erasing) ?? null }}
          initialFocus={cancelRef}
          onClose={() => setErasing(null)}
        >
          <div className="modal-body">
            <h2 id="erase-heading" className="modal-title">Erase contractor {erasing}</h2>
            <p>This removes their name, phone and sign-in for good. Any gate card they hold moves to the order's standby or the window's rostered operator. Their strokes, notices and packs keep the operator code {erasing}.</p>
            <div className="modal-actions">
              <button ref={cancelRef} type="button" className="btn btn-quiet" onClick={() => setErasing(null)}>Cancel</button>
              <button type="button" className="btn btn-commit" onClick={() => erase(erasing)}>Erase for good</button>
            </div>
          </div>
        </Modal>
      )}
    </Page>
  );
}
