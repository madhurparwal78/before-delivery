import { useId, useState } from 'react';
import { HK_ZONE, type CertificateKind, type Currency } from '../../../shared/domain.js';
import { fieldErrorCopy } from '../../../shared/fieldErrors.js';
import { formatAmount, formatDate, formatInstant } from '../../../shared/format.js';
import { ApiError, request } from '../../lib/api.js';
import { useAnnouncer } from '../../lib/announce.jsx';
import { pending, refusal, success } from '../../lib/copy.js';
import { clearDraft, readDraft } from '../../lib/drafts.js';
import { useResource, useWorkspace } from '../../lib/workspace.jsx';
import { ActionButton } from '../../components/Buttons.jsx';
import { Dialog, focusFirstDialogButton } from '../../components/Dialog.jsx';
import { ErrorSummary, Field, focusFieldError, useFormErrors } from '../../components/Fields.jsx';
import { Panel, TableRegion } from '../../components/Panel.jsx';
import type { PanelProps } from '../ProjectPage.jsx';
import { focusWhenReady } from '../../lib/focus.js';

interface SplitPart {
  storeCode: string;
  storeName: string;
  weight: number;
  amountCents: number;
}

interface Certificate {
  id: string;
  number: string;
  kind: CertificateKind;
  periodEnding: string | null;
  grossValuationCents: number | null;
  valuationThisPeriodCents: number | null;
  retentionThisPeriodCents: number | null;
  retentionHeldCents: number;
  amountDueCents: number;
  currency: Currency;
  storeSplit: SplitPart[];
  issuedBy: string;
  issuedAt: string;
}

interface LedgerEntry {
  id: string;
  movementId: string;
  certificateNumber: string;
  kind: string;
  account: string;
  side: string;
  amountCents: number;
  postedAt: string;
}

const KIND_LABELS: Record<CertificateKind, string> = {
  interim: 'Interim',
  retention_release_half: 'Retention release, half',
  retention_release_final: 'Retention release, final',
};

export function CertificatesPanel(props: PanelProps): JSX.Element {
  const formId = useId();
  const { project, restoreForm } = props;
  const { startPending, say, problem } = useAnnouncer();
  const { member, refresh, handleFailure } = useWorkspace();
  const errors = useFormErrors();
  const certificates = useResource<{ certificates: Certificate[] }>(
    `/api/projects/${project.id}/certificates`,
    [project.id],
  );
  const mayIssue = member?.role === 'director' || member?.role === 'project_lead';
  const mayReadLedger = mayIssue || member?.role === 'finance';
  const ledger = useResource<{ entries: LedgerEntry[]; retentionHeldCents: number }>(
    mayReadLedger ? `/api/projects/${project.id}/retention-ledger` : null,
    [project.id],
  );

  const [dialog, setDialog] = useState<'issue' | 'completion' | 'final' | null>(
    restoreForm === 'issue-certificate' ? 'issue' : null,
  );
  const [periodEnding, setPeriodEnding] = useState('');
  const [gross, setGross] = useState('');
  const [completionDate, setCompletionDate] = useState('');
  const [busy, setBusy] = useState(false);

  if (restoreForm === 'issue-certificate' && member) {
    const stored = readDraft(member.id, 'issue-certificate');
    if (stored) {
      clearDraft(member.id, 'issue-certificate');
      if (periodEnding === '') setPeriodEnding(String(stored.periodEnding ?? ''));
      if (gross === '') setGross(String(stored.gross ?? ''));
    }
  }

  const list = certificates.data?.certificates ?? [];

  const focusCertificate = (number: string): void => {
    focusWhenReady(`[data-certificate="${number}"]`);
  };

  const parseAmount = (text: string): number => {
    const trimmed = text.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return Number.NaN;
    const [whole = '0', fraction = ''] = trimmed.split('.');
    return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  };

  const issue = async (): Promise<void> => {
    const amount = parseAmount(gross);
    if (Number.isNaN(amount)) {
      errors.set({ grossValuationCents: fieldErrorCopy.badAmount() });
      focusFieldError(formId, 'grossValuationCents');
      return;
    }
    setBusy(true);
    errors.clear();
    startPending(pending.issueCertificate);
    try {
      const result = await request<{ certificate: Certificate }>(
        `/api/projects/${project.id}/certificates`,
        { body: { periodEnding, grossValuationCents: amount } },
      );
      setDialog(null);
      setPeriodEnding('');
      setGross('');
      refresh();
      certificates.reload();
      ledger.reload();
      say(
        success.certificateIssued(
          result.certificate.number,
          formatAmount(result.certificate.amountDueCents, result.certificate.currency),
        ),
      );
      focusCertificate(result.certificate.number);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'validation') {
        errors.set(caught.errors);
        const first = Object.keys(caught.errors)[0];
        if (first) focusFieldError(formId, first);
      } else if (caught instanceof ApiError && caught.code === 'no_contract') {
        problem(refusal.otherIllegal('without a contract'));
        focusFirstDialogButton();
      } else {
        handleFailure(caught, {
          draft: { formKey: 'issue-certificate', values: { periodEnding, gross } },
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const recordCompletion = async (): Promise<void> => {
    setBusy(true);
    errors.clear();
    startPending(pending.recordPracticalCompletion);
    try {
      const result = await request<{ certificate: Certificate }>(
        `/api/projects/${project.id}/practical-completion`,
        { body: { date: completionDate } },
      );
      setDialog(null);
      refresh();
      certificates.reload();
      ledger.reload();
      say(
        success.practicalCompletion(
          result.certificate.number,
          formatAmount(result.certificate.amountDueCents, result.certificate.currency),
        ),
      );
      focusCertificate(result.certificate.number);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'validation') {
        errors.set(caught.errors);
        const first = Object.keys(caught.errors)[0];
        if (first) focusFieldError(formId, first);
      } else {
        handleFailure(caught, {
          draft: { formKey: 'practical-completion', values: { completionDate } },
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const finalRelease = async (): Promise<void> => {
    setBusy(true);
    startPending(pending.finalRelease);
    try {
      const result = await request<{ certificate: Certificate }>(
        `/api/projects/${project.id}/retention/final-release`,
        { body: {} },
      );
      setDialog(null);
      refresh();
      certificates.reload();
      ledger.reload();
      say(
        success.finalRelease(
          result.certificate.number,
          formatAmount(result.certificate.amountDueCents, result.certificate.currency),
        ),
      );
      focusCertificate(result.certificate.number);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'defects_period_running') {
        problem(
          refusal.defectsPeriodRunning(caught.extra<string>('defectsEndOn') ?? ''),
        );
        focusFirstDialogButton();
      } else {
        handleFailure(caught);
        focusFirstDialogButton();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      sheetCode={props.sheetCode}
      revision={props.revision}
      name={props.panelName}
      heading={<h2 className="panel-heading">Certificates</h2>}
    >
      <p className="meta">
        {project.contract
          ? `Contract with ${project.contract.companyName} for ${formatAmount(
              project.contract.contractSumCents,
              project.currency,
            )}.`
          : 'No contract has been recorded, so no certificate can be issued.'}
      </p>
      {project.practicalCompletionOn ? (
        <p className="meta">
          {`Practical completion ${formatDate(project.practicalCompletionOn)} · defects period ends ${
            project.defectsEndOn ? formatDate(project.defectsEndOn) : '—'
          }`}
        </p>
      ) : null}

      {mayIssue ? (
        <div className="panel-actions">
          <button
            type="button"
            className="primary"
            onClick={() => {
              errors.clear();
              setDialog('issue');
            }}
          >
            Issue certificate
          </button>
          {!project.practicalCompletionOn ? (
            <button
              type="button"
              onClick={() => {
                errors.clear();
                setDialog('completion');
              }}
            >
              Record practical completion
            </button>
          ) : null}
          {project.practicalCompletionOn ? (
            <button type="button" onClick={() => setDialog('final')}>
              Release final retention
            </button>
          ) : null}
        </div>
      ) : null}

      <TableRegion label="Certificates table">
        <table>
          <caption>Certificates</caption>
          <thead>
            <tr>
              <th scope="col">Certificate</th>
              <th scope="col">Kind</th>
              <th scope="col">Period ending</th>
              <th scope="col" className="numeric">
                Gross to date
              </th>
              <th scope="col" className="numeric">
                This period
              </th>
              <th scope="col" className="numeric">
                Retention
              </th>
              <th scope="col" className="numeric">
                Retention held
              </th>
              <th scope="col" className="numeric">
                Amount
              </th>
              <th scope="col">Issued</th>
            </tr>
          </thead>
          <tbody>
            {list.map((certificate) => (
              <tr key={certificate.id}>
                <th scope="row">
                  <a
                    href={`/api/certificates/${certificate.id}`}
                    data-certificate={certificate.number}
                    onClick={(event) => event.preventDefault()}
                  >
                    {certificate.number}
                  </a>
                </th>
                <td>{KIND_LABELS[certificate.kind]}</td>
                <td>
                  {certificate.periodEnding ? formatDate(certificate.periodEnding) : '—'}
                </td>
                <td className="numeric">
                  {certificate.grossValuationCents === null
                    ? '—'
                    : formatAmount(certificate.grossValuationCents, certificate.currency)}
                </td>
                <td className="numeric">
                  {certificate.valuationThisPeriodCents === null
                    ? '—'
                    : formatAmount(certificate.valuationThisPeriodCents, certificate.currency)}
                </td>
                <td className="numeric">
                  {certificate.retentionThisPeriodCents === null
                    ? '—'
                    : formatAmount(certificate.retentionThisPeriodCents, certificate.currency)}
                </td>
                <td className="numeric">
                  {formatAmount(certificate.retentionHeldCents, certificate.currency)}
                </td>
                <td className="numeric">
                  {formatAmount(certificate.amountDueCents, certificate.currency)}
                </td>
                <td>
                  {`${certificate.issuedBy} · ${formatInstant(
                    new Date(certificate.issuedAt),
                    HK_ZONE,
                  )}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableRegion>

      {list.map((certificate) => (
        <div key={`split-${certificate.id}`}>
          <TableRegion label={`Store split ${certificate.number} table`}>
            <table>
              <caption>{`Store split ${certificate.number}`}</caption>
              <thead>
                <tr>
                  <th scope="col">Store code</th>
                  <th scope="col">Store name</th>
                  <th scope="col" className="numeric">
                    Weight
                  </th>
                  <th scope="col" className="numeric">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {certificate.storeSplit.map((part) => (
                  <tr key={part.storeCode}>
                    <th scope="row">{part.storeCode}</th>
                    <td>{part.storeName}</td>
                    <td className="numeric">{part.weight}</td>
                    <td className="numeric">
                      {formatAmount(part.amountCents, certificate.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableRegion>
          {mayReadLedger ? (
            <p>
              <a href={`/api/certificates/${certificate.id}/split.csv`}>
                {`Export split ${certificate.number}`}
              </a>
            </p>
          ) : null}
        </div>
      ))}

      {mayReadLedger ? (
        <>
          <h3>Retention ledger</h3>
          <p className="meta">
            {`Held: ${formatAmount(ledger.data?.retentionHeldCents ?? 0, project.currency)}`}
          </p>
          <TableRegion label="Retention ledger table">
            <table>
              <caption>Retention ledger</caption>
              <thead>
                <tr>
                  <th scope="col">Movement</th>
                  <th scope="col">Certificate</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Account</th>
                  <th scope="col">Side</th>
                  <th scope="col" className="numeric">
                    Amount
                  </th>
                  <th scope="col">Posted</th>
                </tr>
              </thead>
              <tbody>
                {(ledger.data?.entries ?? []).map((entry) => (
                  <tr key={entry.id}>
                    <th scope="row">{entry.movementId.slice(0, 8)}</th>
                    <td>{entry.certificateNumber}</td>
                    <td>{entry.kind === 'hold' ? 'Hold' : 'Release'}</td>
                    <td>
                      {entry.account === 'retention_held'
                        ? 'Retention held'
                        : 'Contractor payable'}
                    </td>
                    <td>{entry.side === 'debit' ? 'Debit' : 'Credit'}</td>
                    <td className="numeric">
                      {formatAmount(entry.amountCents, project.currency)}
                    </td>
                    <td>{formatInstant(new Date(entry.postedAt), HK_ZONE)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableRegion>
        </>
      ) : null}

      {dialog === 'issue' ? (
        <Dialog
          title="Issue payment certificate"
          onClose={() => setDialog(null)}
          footer={
            <>
              <ActionButton
                className="primary"
                busy={busy}
                pendingLabel={pending.issueCertificate}
                onPress={() => void issue()}
              >
                Confirm and issue
              </ActionButton>
              <button type="button" onClick={() => setDialog(null)}>
                Cancel
              </button>
            </>
          }
        >
          <ErrorSummary formId={formId} errors={errors.errors} />
          <Field
            formId={formId}
            path="periodEnding"
            label="Period ending"
            errors={errors.errors}
            hint="Written as YYYY-MM-DD."
          >
            {(attributes) => (
              <input
                {...attributes}
                type="text"
                placeholder="2026-11-30"
                value={periodEnding}
                onChange={(event) => setPeriodEnding(event.target.value)}
              />
            )}
          </Field>
          <Field
            formId={formId}
            path="grossValuationCents"
            label="Gross valuation to date"
            errors={errors.errors}
          >
            {(attributes) => (
              <input
                {...attributes}
                type="text"
                inputMode="decimal"
                value={gross}
                onChange={(event) => setGross(event.target.value)}
              />
            )}
          </Field>
        </Dialog>
      ) : null}

      {dialog === 'completion' ? (
        <Dialog
          title="Record practical completion"
          onClose={() => setDialog(null)}
          footer={
            <>
              <ActionButton
                className="primary"
                busy={busy}
                pendingLabel={pending.recordPracticalCompletion}
                onPress={() => void recordCompletion()}
              >
                Record and release half
              </ActionButton>
              <button type="button" onClick={() => setDialog(null)}>
                Cancel
              </button>
            </>
          }
        >
          <ErrorSummary formId={formId} errors={errors.errors} />
          <Field
            formId={formId}
            path="date"
            label="Practical completion date"
            errors={errors.errors}
            hint="Written as YYYY-MM-DD."
          >
            {(attributes) => (
              <input
                {...attributes}
                type="text"
                placeholder="2026-10-27"
                value={completionDate}
                onChange={(event) => setCompletionDate(event.target.value)}
              />
            )}
          </Field>
        </Dialog>
      ) : null}

      {dialog === 'final' ? (
        <Dialog
          title="Release final retention"
          onClose={() => setDialog(null)}
          footer={
            <>
              <ActionButton
                className="primary"
                busy={busy}
                pendingLabel={pending.finalRelease}
                onPress={() => void finalRelease()}
              >
                Confirm final release
              </ActionButton>
              <button type="button" onClick={() => setDialog(null)}>
                Cancel
              </button>
            </>
          }
        >
          <p>
            The final release pays out every cent of retention still held, and can only be made
            after the defects period has ended.
          </p>
        </Dialog>
      ) : null}
    </Panel>
  );
}
