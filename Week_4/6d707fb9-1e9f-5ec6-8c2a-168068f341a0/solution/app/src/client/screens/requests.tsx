import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { LANGUAGES, TOWNS, countryName } from "../../shared/catalog";
import type { Line, StyleRow, SupplierRequest } from "../../shared/api";
import { ApiFailure, announce, api, download, failureText, post, useAction, useResource, useTitle } from "../lib";
import { Button, Field, Hidden, Modal, Problems, TableFrame, useDialog, useForm, type DialogControl } from "../ui";
import { RefreshLine } from "../frame";
import { Heading } from "./public";

const STATES: Record<SupplierRequest["state"], string> = { sent: "Sent", reminded: "Reminded", answered: "Answered", ended: "Ended" };
const QUESTION_NAMES: Record<string, string> = { energy: "Energy", water: "Water", fibreOrigin: "Fibre origin" };

function NewRequestForm({ control, onSaved }: { control: DialogControl; onSaved: () => Promise<void> }): JSX.Element {
  const styles = useResource<{ styles: StyleRow[] }>("/api/styles");
  const form = useForm("new-request", {
    styleId: "",
    lineId: "",
    supplierName: "",
    contactName: "",
    contactEmail: "",
    town: "porto",
    language: "en",
    energy: true,
    water: true,
    fibreOrigin: true,
    dueDate: "",
  });
  const { values } = form;
  const styleId = values.styleId || styles.data?.styles[0]?.id || "";
  const [lines, setLines] = useState<Line[]>([]);

  useEffect(() => {
    if (!styleId) return undefined;
    let live = true;
    void api<{ lines: Line[] }>(`/api/styles/${styleId}/lines`).then((answer) => {
      if (live) setLines(answer.lines);
    });
    return () => {
      live = false;
    };
  }, [styleId]);

  const lineId = lines.some((line) => line.id === values.lineId) ? values.lineId : (lines[0]?.id ?? "");

  const save = (event: Event): void => {
    event.preventDefault();
    void form.submit(async () => {
      const made = await post<SupplierRequest>("/api/requests", {
        styleId,
        lineId,
        supplierName: values.supplierName,
        contactName: values.contactName,
        contactEmail: values.contactEmail,
        town: values.town,
        language: values.language,
        questions: ["energy", "water", "fibreOrigin"].filter((question) => values[question as "energy"]),
        dueDate: values.dueDate,
      });
      await onSaved();
      control.hide();
      announce(`Request sent to ${made.supplierName}.`);
    });
  };

  return (
    <form onSubmit={save} noValidate>
      <h2>New request</h2>
      <Problems form={form} aliases={{ questions: "energy" }} />
      <Field form={form} name="styleId" label="Style" value={styleId} onValue={(value) => form.set("styleId", value)} options={(styles.data?.styles ?? []).map((style) => ({ value: style.id, label: style.name }))} />
      <Field form={form} name="lineId" label="Material line" value={lineId} onValue={(value) => form.set("lineId", value)} options={lines.map((line) => ({ value: line.id, label: `${line.materialName} (line ${line.position})` }))} />
      <Field form={form} name="supplierName" label="Supplier" value={values.supplierName} onValue={(value) => form.set("supplierName", value)} />
      <Field form={form} name="contactName" label="Contact name" value={values.contactName} onValue={(value) => form.set("contactName", value)} />
      <Field form={form} name="contactEmail" label="Contact email" type="email" value={values.contactEmail} onValue={(value) => form.set("contactEmail", value)} />
      <Field form={form} name="town" label="Town" value={values.town} onValue={(value) => form.set("town", value)} options={TOWNS.map((town) => ({ value: town.id, label: town.name }))} />
      <Field form={form} name="language" label="Language" value={values.language} onValue={(value) => form.set("language", value)} options={LANGUAGES.map((language) => ({ value: language.id, label: language.name }))} />
      <fieldset class="chips">
        <legend>Questions</legend>
        {(["energy", "water", "fibreOrigin"] as const).map((question) => (
          <label key={question} class="chip">
            <input id={question === "energy" ? "field-energy" : undefined} type="checkbox" checked={values[question]} onChange={(event) => form.set(question, event.currentTarget.checked)} />
            <span>{QUESTION_NAMES[question]}</span>
          </label>
        ))}
      </fieldset>
      <Field form={form} name="dueDate" label="Due date" hint="As YYYY-MM-DD" value={values.dueDate} onValue={(value) => form.set("dueDate", value)} />
      <div class="dialog-actions">
        <Button type="submit" green busy={form.busy}>
          Send request
        </Button>
        <Button onPress={control.hide}>Close</Button>
      </div>
    </form>
  );
}

function AnswerRow({ request, setFlat }: { request: SupplierRequest; setFlat: (text: string | null) => void }): JSX.Element {
  const answer = request.answer;
  return (
    <tr class="answer-row">
      <td colSpan={7}>
        {answer ? (
          <ul class="plain-list">
            {answer.energyMjPerKg !== null ? (
              <li>
                Energy: <span class="figure">{answer.energyValue} {answer.energyUnit} per kg, {answer.energyMjPerKg} MJ per kg</span>
              </li>
            ) : null}
            {answer.waterLitresPerKg !== null ? (
              <li>
                Water: <span class="figure">{answer.waterLitresPerKg} L per kg</span>
              </li>
            ) : null}
            {answer.fibreOrigin !== null ? <li>Fibre origin: {countryName(answer.fibreOrigin)}</li> : null}
            {answer.evidenceIds.map((id, index) => (
              <li key={id}>
                <Button
                  onPress={() => {
                    setFlat(null);
                    download(`/api/evidence/${id}/file`, `evidence-${index + 1}`)
                      .then(() => announce("Evidence downloaded."))
                      .catch((error: unknown) => {
                        const message = failureText(error);
                        setFlat(message);
                        announce(message);
                      });
                  }}
                >
                  Download evidence {index + 1}
                  <Hidden> for {request.supplierName}</Hidden>
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </td>
    </tr>
  );
}

function RowControl({ children, action, setFlat }: { children: JSX.Element | JSX.Element[] | string | (string | JSX.Element)[]; action: () => Promise<void>; setFlat: (text: string | null) => void }): JSX.Element {
  const [busy, run] = useAction();
  return (
    <Button
      class="button-small"
      busy={busy}
      onPress={() =>
        void run(async () => {
          setFlat(null);
          try {
            await action();
          } catch (error) {
            if (error instanceof ApiFailure && error.status === 401) return;
            const message = failureText(error);
            setFlat(message);
            announce(message);
          }
        })
      }
    >
      {children}
    </Button>
  );
}

export function Requests(): JSX.Element {
  useTitle("Requests");
  const requests = useResource<{ requests: SupplierRequest[] }>("/api/requests");
  const dialog = useDialog("new-request");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [flat, setFlat] = useState<string | null>(null);

  const toggle = (id: string): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <main class="desk-main">
      <Heading>Requests</Heading>
      <RefreshLine />
      {flat ? <p class="stone-band">{flat}</p> : null}
      <div class="screen-actions">
        <span />
        <div class="action-bar">
          <Button green onPress={dialog.show}>
            New request
          </Button>
        </div>
      </div>
      <TableFrame name="Requests table">
        <table>
          <thead>
            <tr>
              <th scope="col">Supplier</th>
              <th scope="col">Style</th>
              <th scope="col">Language</th>
              <th scope="col">Town</th>
              <th scope="col">Due</th>
              <th scope="col">State</th>
              <th scope="col">Controls</th>
            </tr>
          </thead>
          {(requests.data?.requests ?? []).map((request) => (
            <tbody key={request.id}>
              <tr>
                <td>{request.supplierName}</td>
                <td>{request.styleName}</td>
                <td>{LANGUAGES.find((language) => language.id === request.language)?.name}</td>
                <td>{request.townName}</td>
                <td class="figure">{request.dueDate}</td>
                <td>{STATES[request.state]}</td>
                <td class="row-controls">
                  <Button class="button-small" onPress={() => toggle(request.id)}>
                    Show answer<Hidden> for {request.supplierName}</Hidden>
                  </Button>
                  {request.state !== "answered" ? (
                    <RowControl
                      setFlat={setFlat}
                      action={async () => {
                        await post(`/api/requests/${request.id}/new-address`);
                        await requests.reload();
                        announce(`New address sent to ${request.supplierName}.`);
                      }}
                    >
                      New address<Hidden> for {request.supplierName}</Hidden>
                    </RowControl>
                  ) : null}
                  {request.state === "sent" || request.state === "reminded" ? (
                    <RowControl
                      setFlat={setFlat}
                      action={async () => {
                        await post(`/api/requests/${request.id}/end`);
                        await requests.reload();
                        announce(`Page ended for ${request.supplierName}.`);
                      }}
                    >
                      End page<Hidden> for {request.supplierName}</Hidden>
                    </RowControl>
                  ) : null}
                </td>
              </tr>
              {expanded.has(request.id) ? <AnswerRow request={request} setFlat={setFlat} /> : null}
            </tbody>
          ))}
        </table>
      </TableFrame>
      {requests.data && !requests.data.requests.length ? (
        <div class="empty-state">
          <div class="fragment fragment-empty" aria-hidden="true">
            <span class="fake-button">New request</span>
          </div>
          <p>No requests yet. Press New request to ask a supplier.</p>
        </div>
      ) : null}
      <Modal name="New request" control={dialog}>
        <NewRequestForm control={dialog} onSaved={requests.reload} />
      </Modal>
    </main>
  );
}
