// Review (operator home): uploaded documents waiting for review, approved or rejected from the queue.

import { useState } from "preact/hooks";
import type { CertificateDocument, MemberSummary } from "../../shared/api.js";
import type { Session } from "../App.js";
import { get, post } from "../api.js";
import { perform } from "../feedback.js";
import { DOCUMENT_KIND_WORDS } from "../format.js";
import { Download } from "../icons.js";
import { Cell, ScreenHead, useData } from "./shared.js";

function EmptyQueue() {
  return (
    <div class="empty">
      <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true" focusable="false">
        <rect x="12" y="8" width="32" height="42" rx="2" fill="none" stroke="currentColor" stroke-width="1.5" />
        <rect x="21" y="4" width="14" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.5" />
        <path d="m20 30 6 6 11-12" fill="none" stroke="currentColor" stroke-width="2" />
      </svg>
      <p>Nothing waiting for review.</p>
    </div>
  );
}

export function ReviewScreen(_props: { session: Session }) {
  const queue = useData(async () => {
    const [docs, members] = await Promise.all([get<{ documents: CertificateDocument[] }>("/api/documents?status=uploaded"), get<{ members: MemberSummary[] }>("/api/members")]);
    return { documents: docs.documents, members: members.members };
  }, []);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const decide = async (doc: CertificateDocument, decision: "approve" | "reject") => {
    setBusy(doc.id);
    await perform(
      "Saving review…",
      () => post<{ document: CertificateDocument }>(`/api/documents/${doc.id}/${decision}`, decision === "reject" ? { reason: reasons[doc.id] ?? "" } : {}),
      () => (decision === "approve" ? "Document approved." : "Document rejected."),
      (failure) => {
        if (failure.body.error === "invalid_transition") return { text: "This document was already reviewed." };
        if (failure.body.errors?.reason) return { text: "Give a rejection reason of 1 to 200 characters." };
        return null;
      },
    );
    setBusy(null);
    await queue.reload();
  };

  const business = (memberId: string) => queue.data?.members.find((m) => m.id === memberId)?.business_name ?? memberId;
  const rows = queue.data?.documents ?? [];
  return (
    <section class="screen">
      <ScreenHead title="Review">
        <p class="screen-head__note">Approve a certificate only when it matches its expiry date and holder.</p>
      </ScreenHead>
      <table class="table">
        <caption>Documents to review</caption>
        <thead>
          <tr>
            <th scope="col">Business</th>
            <th scope="col">Type</th>
            <th scope="col">Person</th>
            <th scope="col">Expires on</th>
            <th scope="col">File</th>
            <th scope="col">Decision</th>
          </tr>
        </thead>
        <tbody>
          {!queue.data && (
            <tr class="table__empty">
              <td colSpan={6}>Loading…</td>
            </tr>
          )}
          {queue.data && rows.length === 0 && (
            <tr class="table__empty">
              <td colSpan={6}>
                <EmptyQueue />
              </td>
            </tr>
          )}
          {rows.map((doc) => (
            <tr key={doc.id}>
              <Cell label="Business">{business(doc.member_id)}</Cell>
              <Cell label="Type">{DOCUMENT_KIND_WORDS[doc.kind]}</Cell>
              <Cell label="Person">{doc.crew_cook_name ?? business(doc.member_id)}</Cell>
              <Cell label="Expires on">
                {doc.expires_on}
              </Cell>
              <Cell label="File">
                <a class="link-button" href={`/api/documents/${doc.id}/file`} download>
                  <Download />
                  <span>Download</span>
                </a>
              </Cell>
              <Cell label="Decision">
                <div class="decision">
                  <label class="field field--compact">
                    <span class="field__label">Rejection reason</span>
                    <input type="text" maxLength={200} value={reasons[doc.id] ?? ""} onInput={(e) => setReasons({ ...reasons, [doc.id]: e.currentTarget.value })} />
                  </label>
                  <div class="decision__buttons">
                    <button type="button" class="button button--primary" disabled={busy !== null} aria-busy={busy === doc.id ? "true" : "false"} onClick={() => void decide(doc, "approve")}>
                      Approve
                    </button>
                    <button type="button" class="button" disabled={busy !== null} onClick={() => void decide(doc, "reject")}>
                      Reject
                    </button>
                  </div>
                </div>
              </Cell>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
