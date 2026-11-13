// The visit page: one touch-first column, reached only through its private address.

import { CollectAnswer, KitCodesAnswer, VisitView } from "../shared/api";
import { formatDate, zoneTime } from "../shared/format";
import { cityOf } from "../shared/time";
import { getJson, sendJson } from "./api";
import { CloudField, TubeGlyph } from "./glyphs";
import { ActionBar, Button, onSubmit, PageHeading, Problems, TextField, useAction, useForm, useLoad } from "./ui";

function EndedOrUnknown({ title }: { title: string }) {
  return (
    <>
      <CloudField />
      <main className="page visit-page"><PageHeading>{title}</PageHeading></main>
    </>
  );
}

export function VisitScreen({ token }: { token: string }) {
  const visit = useLoad(() => getJson(`/api/visits/${token}`, VisitView), `visit-${token}`);
  const form = useForm(`visit-${token}`, { kitCode: "" });
  const addAction = useAction();
  const markAction = useAction();

  if (visit.failed?.status === 410) return <EndedOrUnknown title="This visit page has ended." />;
  if (visit.failed?.status === 404) return <EndedOrUnknown title="We can't find that page." />;
  const data = visit.data;
  if (!data) return <main className="page visit-page" />;

  const addCode = (): void => {
    void addAction.run(async () => {
      const before = data.kitCodes;
      const answer = await sendJson("POST", `/api/visits/${token}/kit-codes`, { kitCode: form.value("kitCode") }, KitCodesAnswer);
      const added = answer.kitCodes.find((code) => !before.includes(code));
      form.set("kitCode", "");
      await visit.reload();
      return added ? `Kit code ${added} added.` : null;
    });
  };

  const markCollected = (): void => {
    void markAction.run(async () => {
      const answer = await sendJson("POST", `/api/visits/${token}/collect`, {}, CollectAnswer);
      await visit.reload();
      return `Marked collected at ${zoneTime(answer.collectedAt, data.timeZone)}.`;
    });
  };

  return (
    <>
      <CloudField />
      <main className="page visit-page">
        <PageHeading>{`Visit for ${data.memberName}`}</PageHeading>
        <section className="card">
          <p className="visit-time">{formatDate(data.localDate)}, {data.localTime} {cityOf(data.timeZone)} time</p>
          <p className="muted">{data.state === "collected" ? "Collected" : "Booked"}</p>
        </section>
        <section className="card" role="region" aria-label="Address">
          <h2>Address</h2>
          {data.address ? (
            <>
              <p>{data.address.line1}{data.address.line2 ? `, ${data.address.line2}` : ""}</p>
              <p>{data.address.city}, {data.address.state.toUpperCase()} {data.address.postalCode}</p>
              {data.gateNotes ? <p className="gate-notes">{data.gateNotes}</p> : null}
            </>
          ) : <p>Address shown on the visit day.</p>}
        </section>
        <form className="card stack" noValidate onSubmit={onSubmit(addCode)}>
          <Problems form={form.id} action={addAction} />
          <TextField form={form} name="kitCode" label="Kit code" problem={addAction.problem} />
          <Button type="submit" kind="secondary" action={addAction}>Add kit code</Button>
          <ul aria-label="Kit codes" className="kit-codes">
            {data.kitCodes.map((code) => <li key={code}><TubeGlyph size={24} /><span>{code}</span></li>)}
          </ul>
        </form>
        <ActionBar always><Button action={markAction} onClick={markCollected}>Mark collected</Button></ActionBar>
      </main>
    </>
  );
}
