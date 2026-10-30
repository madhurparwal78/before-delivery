import { useState } from "react";
import { flushSync } from "react-dom";
import { formatAmount, formatDate, formatTime } from "../../../../shared/format";
import { post, type ErrorBody, type Result } from "../../api";
import { otherIllegal } from "../copy";
import { useOffice } from "../context";
import { Dialog, focusRefusal, openDialog } from "../dialog";
import { amountInput, ErrorSummary, TextField, useFormId, type Errors } from "../fields";
import { ActionButton, TableRegion, domId, focusId } from "../layout";
import { PanelTitle, useProject } from "../project";
import { useResource } from "../resource";
import "./certificates.css";

// PL-05 Certificates: interim payment certificates with retention, the two retention releases, each
// certificate's per-store split and the paired retention ledger. Every figure comes from the server.

type Kind = "interim" | "retention_release_half" | "retention_release_final";

interface Certificate {
  id: string;
  number: string;
  kind: Kind;
  periodEnding: string | null;
  grossValuationCents: number | null;
  valuationThisPeriodCents: number | null;
  retentionThisPeriodCents: number | null;
  retentionHeldCents: number;
  amountDueCents: number;
  storeSplit: { storeCode: string; storeName: string; weight: number; amountCents: number }[];
  issuedBy: { name: string };
  issuedAt: string;
}

interface Ledger {
  entries: { id: string; movementId: string; certificateNumber: string; kind: "hold" | "release"; account: string; side: "debit" | "credit";
    amountCents: number; postedAt: string }[];
  retentionHeldCents: number;
}

const KIND_LABEL: Record<Kind, string> = {
  interim: "Interim certificate", retention_release_half: "Retention release, half", retention_release_final: "Final retention release",
};
const ACCOUNT_LABEL: Record<string, string> = { contractor_payable: "Contractor payable", retention_held: "Retention held" };

type Open = "issue" | "completion" | "final" | null;

const linkId = (number: string): string => domId("certificate", number);

export function CertificatesPanel() {
  const office = useOffice();
  const { project, reloadProject } = useProject();
  const role = office.member?.role;
  const issues = role === "director" || role === "project_lead";
  const reviews = issues || role === "finance";
  const certificates = useResource<{ certificates: Certificate[]; actions: string[] }>(`/api/projects/${project.id}/certificates`);
  const ledger = useResource<Ledger>(reviews ? `/api/projects/${project.id}/retention-ledger` : null);
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const [values, setValues] = useState({ periodEnding: "", gross: "", date: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [dialogError, setDialogError] = useState("");
  const form = useFormId("certificate");

  const list = certificates.data?.certificates ?? [];
  const shown = list.find((c) => c.number === selected) ?? list.at(-1);
  const money = (cents: number | null): string => (cents === null ? "—" : formatAmount(project.currency, cents));
  const can = (action: string): boolean => !!certificates.data?.actions.includes(action);

  const show = (which: Open): void => {
    setValues({ periodEnding: "", gross: "", date: "" });
    setErrors({});
    setDialogError("");
    setOpen(which);
  };

  const refusal = (body: ErrorBody): string => {
    if (body.error === "defects_period_running") return `Final retention can be released after ${formatDate(String(body.defectsEndOn))}.`;
    if (body.error === "no_contract") return otherIllegal("without a contract");
    return otherIllegal(String(body.from ?? body.error));
  };

  const submit = async (request: Promise<Result<{ certificate: Certificate }>>, success: (certificate: Certificate) => string,
    draft: string): Promise<void> => {
    const result = await request;
    if (!result.ok) {
      const body = office.refused(result, { id: draft, values: { ...values } });
      if (body?.error === "validation" && body.errors) {
        flushSync(() => {
          setErrors(body.errors ?? {});
          setDialogError("");
        });
      } else if (body) {
        const copy = refusal(body);
        flushSync(() => {
          setErrors({});
          setDialogError(copy);
        });
        office.alert(copy);
      }
      focusRefusal(openDialog());
      return;
    }
    const certificate = result.data.certificate;
    flushSync(() => {
      setOpen(null);
      setSelected(certificate.number);
    });
    await Promise.all([certificates.reload(), ledger.reload(), reloadProject()]);
    focusId(linkId(certificate.number));
    office.announce(success(certificate));
  };

  const base = `/api/projects/${project.id}`;
  const issueCertificate = (): Promise<void> => submit(
    post(`${base}/certificates`, { periodEnding: values.periodEnding, grossValuationCents: amountInput(values.gross) }),
    (c) => `Certificate ${c.number} issued: ${money(c.amountDueCents)} due.`, "issue-certificate");
  const recordCompletion = (): Promise<void> => submit(
    post(`${base}/practical-completion`, { date: values.date }),
    (c) => `Practical completion recorded. Retention release ${c.number} issued for ${money(c.amountDueCents)}.`, "practical-completion");
  const finalRelease = (): Promise<void> => submit(
    post(`${base}/retention/final-release`, {}),
    (c) => `Final retention release ${c.number} issued for ${money(c.amountDueCents)}.`, "final-release");

  return (
    <div className="certificates">
      <PanelTitle section="certificates" />
      <div className="panel-heading">
        <div>
          <h2>Certificates</h2>
          <dl className="contract-figures">
            <div><dt>Contract</dt><dd>{project.contract ? `${project.contract.companyName}, ${money(project.contract.contractSumCents)}` : "No contract yet"}</dd></div>
            <div><dt>Retention held</dt><dd>{ledger.data ? money(ledger.data.retentionHeldCents) : shown ? money(shown.retentionHeldCents) : money(0)}</dd></div>
            <div><dt>Practical completion</dt><dd>{project.practicalCompletionOn ? formatDate(project.practicalCompletionOn) : "Not recorded"}</dd></div>
            {project.defectsEndOn && <div><dt>Defects period ends</dt><dd>{formatDate(project.defectsEndOn)}</dd></div>}
          </dl>
        </div>
        {issues && (
          <div className="actions">
            {can("issue") && <button type="button" className="button button-primary" onClick={() => show("issue")}>Issue certificate</button>}
            {can("record_practical_completion") && (
              <button type="button" className="button" onClick={() => show("completion")}>Record practical completion</button>
            )}
            {can("release_final") && (
              <button type="button" className="button" onClick={() => show("final")}>Release final retention</button>
            )}
          </div>
        )}
      </div>

      <div className="panel-body certificate-grid">
        <TableRegion label="Certificates, scrollable">
          <table aria-label="Certificates">
            <thead>
              <tr>
                <th scope="col">Certificate</th><th scope="col">Kind</th><th scope="col">Period ending</th>
                <th scope="col" className="num">Valuation this period</th><th scope="col" className="num">Retention this period</th>
                <th scope="col" className="num">Retention held</th><th scope="col" className="num">Amount due</th><th scope="col">Issued</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className={shown?.id === c.id ? "selected" : undefined}>
                  <td>
                    <a id={linkId(c.number)} href={`#split-${c.number}`} aria-current={shown?.id === c.id ? "true" : undefined}
                      onClick={(event) => {
                        event.preventDefault();
                        setSelected(c.number);
                      }}>{c.number}</a>
                  </td>
                  <td>{KIND_LABEL[c.kind]}</td>
                  <td>{c.periodEnding ? formatDate(c.periodEnding) : "—"}</td>
                  <td className="num">{money(c.valuationThisPeriodCents)}</td>
                  <td className="num">{money(c.retentionThisPeriodCents)}</td>
                  <td className="num">{money(c.retentionHeldCents)}</td>
                  <td className="num">{money(c.amountDueCents)}</td>
                  <td>{formatTime(c.issuedAt, project.timeZone)}</td>
                </tr>
              ))}
              {certificates.data && !list.length && (
                <tr><td colSpan={8} className="empty-line">No certificates yet.</td></tr>
              )}
            </tbody>
          </table>
        </TableRegion>

        {shown && (
          <section className="split" id={`split-${shown.number}`} aria-labelledby={domId("split-heading", shown.number)}>
            <div className="split-head">
              <h3 id={domId("split-heading", shown.number)}>{shown.number} across the stores</h3>
              {reviews && <a className="button" href={`/api/certificates/${shown.id}/split.csv`} download>Export split {shown.number}</a>}
            </div>
            <TableRegion label={`Store split ${shown.number}, scrollable`}>
              <table aria-label={`Store split ${shown.number}`}>
                <thead>
                  <tr><th scope="col">Store</th><th scope="col">Name</th><th scope="col" className="num">Weight</th><th scope="col" className="num">Amount</th></tr>
                </thead>
                <tbody>
                  {shown.storeSplit.map((part) => (
                    <tr key={part.storeCode}>
                      <td>{part.storeCode}</td><td>{part.storeName}</td><td className="num">{part.weight}</td><td className="num">{money(part.amountCents)}</td>
                    </tr>
                  ))}
                  <tr className="total-row">
                    <td colSpan={3}>Certificate {shown.kind === "interim" ? "amount due" : "release"}</td><td className="num">{money(shown.amountDueCents)}</td>
                  </tr>
                </tbody>
              </table>
            </TableRegion>
          </section>
        )}

        {reviews && ledger.data && (
          <section className="ledger" aria-labelledby="ledger-heading">
            <h3 id="ledger-heading">Retention ledger</h3>
            <TableRegion label="Retention ledger, scrollable">
              <table aria-label="Retention ledger">
                <thead>
                  <tr>
                    <th scope="col">Posted</th><th scope="col">Certificate</th><th scope="col">Movement</th><th scope="col">Account</th>
                    <th scope="col" className="num">Debit</th><th scope="col" className="num">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.data.entries.map((entry) => (
                    <tr key={entry.id}>
                      <td>{formatTime(entry.postedAt, project.timeZone)}</td>
                      <td>{entry.certificateNumber}</td>
                      <td>{entry.kind === "hold" ? "Hold" : "Release"}</td>
                      <td>{ACCOUNT_LABEL[entry.account] ?? entry.account}</td>
                      <td className="num">{entry.side === "debit" ? money(entry.amountCents) : ""}</td>
                      <td className="num">{entry.side === "credit" ? money(entry.amountCents) : ""}</td>
                    </tr>
                  ))}
                  {!ledger.data.entries.length && <tr><td colSpan={6} className="empty-line">No retention has been held yet.</td></tr>}
                  <tr className="total-row"><td colSpan={5}>Retention held</td><td className="num">{money(ledger.data.retentionHeldCents)}</td></tr>
                </tbody>
              </table>
            </TableRegion>
          </section>
        )}
      </div>

      <Dialog title="Issue payment certificate" open={open === "issue"} onCancel={() => setOpen(null)} error={dialogError}
        actions={<ActionButton primary type="submit" pending="Issuing…" onAction={issueCertificate}>Confirm and issue</ActionButton>}>
        <ErrorSummary errors={errors} form={form} />
        <TextField form={form} name="periodEnding" label="Period ending" type="date" value={values.periodEnding} error={errors.periodEnding}
          onChange={(periodEnding) => setValues((v) => ({ ...v, periodEnding }))} />
        <TextField form={form} name="grossValuationCents" label="Gross valuation to date" inputMode="decimal" value={values.gross}
          hint={`${project.currency}, like 1250.00`} error={errors.grossValuationCents} onChange={(gross) => setValues((v) => ({ ...v, gross }))} />
      </Dialog>

      <Dialog title="Record practical completion" open={open === "completion"} onCancel={() => setOpen(null)} error={dialogError}
        actions={<ActionButton primary type="submit" pending="Recording…" onAction={recordCompletion}>Record and release half</ActionButton>}>
        <ErrorSummary errors={errors} form={form} />
        <TextField form={form} name="date" label="Practical completion date" type="date" value={values.date} error={errors.date}
          onChange={(date) => setValues((v) => ({ ...v, date }))} />
        <p className="dialog-note">Half of the retention held is released on this certificate; the rest after the defects period.</p>
      </Dialog>

      <Dialog title="Release final retention" open={open === "final"} onCancel={() => setOpen(null)} error={dialogError}
        actions={<ActionButton primary type="submit" pending="Releasing…" onAction={finalRelease}>Confirm final release</ActionButton>}>
        <p className="dialog-note">
          This releases all retention still held{ledger.data ? `, ${money(ledger.data.retentionHeldCents)}` : ""}, to {project.contract?.companyName ?? "the contractor"}.
        </p>
      </Dialog>
    </div>
  );
}
