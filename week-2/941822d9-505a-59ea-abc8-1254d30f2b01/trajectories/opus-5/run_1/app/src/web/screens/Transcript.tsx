import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { request } from '../lib/api.js';
import { CERTIFICATE_STATE_LABELS, formatProviderDate } from '../lib/format.js';
import { Link } from '../lib/router.js';
import { ShareDialog } from '../components/ShareDialog.js';
import type { Certificate } from '../lib/types.js';

export function Transcript(): ReactNode {
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [totalHours, setTotalHours] = useState('0.00');
  const [shareFor, setShareFor] = useState<Certificate | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const result = await request<{ certificates: Certificate[]; total_hours: string }>(
      '/api/me/transcript',
    );
    setCertificates(result.certificates);
    setTotalHours(result.total_hours);
  }, []);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  return (
    <>
      <h1>Transcript</h1>
      <div className="table-wrap">
        <table className="stacked">
          <caption className="sr-only">Certificates</caption>
          <thead>
            <tr>
              <th scope="col">Course</th>
              <th scope="col">Serial</th>
              <th scope="col">Issued</th>
              <th scope="col" className="num">
                Hours
              </th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {certificates.map((certificate) => {
              const pendingFirstPdf = certificate.state === 'sealing';
              return (
                <tr key={certificate.id}>
                  <td data-label="Course">{certificate.course_title}</td>
                  <td data-label="Serial">{certificate.serial}</td>
                  <td data-label="Issued">
                    {pendingFirstPdf || certificate.issued_on === null
                      ? 'Pending'
                      : formatProviderDate(certificate.issued_on)}
                  </td>
                  <td data-label="Hours" className="num">
                    {certificate.contact_hours}
                  </td>
                  <td data-label="Status">
                    {pendingFirstPdf ? 'Pending' : CERTIFICATE_STATE_LABELS[certificate.state]}
                  </td>
                  <td data-label="Actions">
                    <span className="inline-actions">
                      {certificate.state === 'sealed' ? (
                        <button type="button" className="quiet" onClick={() => setShareFor(certificate)}>
                          Share
                        </button>
                      ) : null}
                      <Link to={`/learn/${certificate.enrolment_id}/seal`}>View seal</Link>
                    </span>
                  </td>
                </tr>
              );
            })}
            <tr className="total">
              <td data-label="Total earned hours" colSpan={3}>
                Total earned hours
              </td>
              <td data-label="Hours" className="num">
                {totalHours}
              </td>
              <td colSpan={2} />
            </tr>
          </tbody>
        </table>
      </div>

      {shareFor === null ? null : (
        <ShareDialog
          certificate={shareFor}
          onClose={() => {
            setShareFor(null);
            void load().catch(() => undefined);
          }}
        />
      )}
    </>
  );
}
