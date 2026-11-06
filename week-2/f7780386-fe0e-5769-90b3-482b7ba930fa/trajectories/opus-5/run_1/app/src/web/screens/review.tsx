import { useCallback, useEffect, useState, type ReactNode } from 'react';

import type { DocumentRecord, MemberSummary } from '../../shared/api.js';
import { api } from '../api.js';
import { useAction } from '../app-state.js';

export function ReviewScreen(): ReactNode {
  const act = useAction();
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');

  const refresh = useCallback(async () => {
    const [docs, memberList] = await Promise.all([
      api<{ documents: DocumentRecord[] }>('/api/documents?status=uploaded'),
      api<{ members: MemberSummary[] }>('/api/members'),
    ]);
    setDocuments(docs.documents);
    setMembers(memberList.members);
  }, []);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  const review = async (id: string, decision: 'approve' | 'reject'): Promise<void> => {
    setBusy(id + decision);
    await act(
      'Saving review…',
      async () => {
        await api(`/api/documents/${id}/${decision}`, {
          method: 'POST',
          body: decision === 'reject' ? { reason: reasons[id] ?? 'Not accepted' } : {},
        });
        await refresh();
        return decision === 'approve' ? 'Document approved.' : 'Document rejected.';
      },
      (error) =>
        error.code === 'validation_failed'
          ? 'This document was already reviewed.'
          : 'This document was already reviewed.',
    );
    setBusy('');
  };

  const businessOf = (memberId: string): string =>
    members.find((member) => member.id === memberId)?.business_name ?? memberId;

  return (
    <>
      <h1>Review</h1>
      <table>
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
          {documents.map((document) => (
            <tr key={document.id}>
              <td data-label="Business">{businessOf(document.member_id)}</td>
              <td data-label="Type">
                {document.kind === 'liability_insurance'
                  ? 'Liability insurance'
                  : 'Food handler card'}
              </td>
              <td data-label="Person">{document.crew_cook_name ?? '—'}</td>
              <td data-label="Expires on" className="num">
                {document.expires_on}
              </td>
              <td data-label="File">
                <a href={`/api/documents/${document.id}/file`}>Download</a>
              </td>
              <td data-label="Decision">
                <label htmlFor={`reason-${document.id}`}>Rejection reason</label>
                <input
                  id={`reason-${document.id}`}
                  type="text"
                  value={reasons[document.id] ?? ''}
                  onChange={(event) =>
                    setReasons((current) => ({ ...current, [document.id]: event.target.value }))
                  }
                />
                <button
                  type="button"
                  className="primary"
                  disabled={busy === document.id + 'approve'}
                  aria-busy={busy === document.id + 'approve'}
                  onClick={() => void review(document.id, 'approve')}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={busy === document.id + 'reject'}
                  aria-busy={busy === document.id + 'reject'}
                  onClick={() => void review(document.id, 'reject')}
                >
                  Reject
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
