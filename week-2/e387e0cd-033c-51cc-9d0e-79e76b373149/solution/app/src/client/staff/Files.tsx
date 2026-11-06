// The regulator's monthly files: a month picker (a rail from 1120 px, the Choose month sheet below) and the download.
import { useState } from "preact/hooks";
import { useResource, useWide } from "../hooks";
import { Heading } from "../router";
import { say } from "../store";
import { Dialog } from "../ui/Dialog";
import { ActionNote, Button } from "../ui/forms";
import { Icon } from "../ui/Icon";
import { Fig } from "../ui/Table";
import { formatMonth } from "../../shared/format";
import { downloadFile } from "./common-download";
import { useDesk } from "./desk";

interface FileMonth {
  month: string;
  cases: number;
}

const DOWNLOAD = "download-file";

function MonthPicker({ id, months, value, onChange }: { id: string; months: FileMonth[]; value: string; onChange: (ym: string) => void }) {
  return (
    <div class="field">
      <label class="field-label" for={id}>Month</label>
      <div class="select-wrap">
        <select id={id} class="input select" value={value} onChange={(e) => onChange(e.currentTarget.value)}>
          {months.map((m) => <option key={m.month} value={m.month}>{formatMonth(m.month)}</option>)}
        </select>
        <Icon name="chevron" size={18} />
      </div>
    </div>
  );
}

export function FilesScreen() {
  const desk = useDesk();
  const wide = useWide();
  const [loaded] = useResource<{ months: FileMonth[] }>(`/api${desk.base}/files`);
  const [picked, setPicked] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const months = loaded.state === "ready" ? loaded.data.months : [];
  const current = desk.workspace.today.slice(0, 7);
  const month = picked ?? months.find((m) => m.month < current)?.month ?? months[0]?.month ?? "";
  const chosen = months.find((m) => m.month === month);

  const download = async () => {
    say(DOWNLOAD, "Preparing file…", "pending");
    setBusy(true);
    const result = await downloadFile(`/api${desk.base}/files/regulator?month=${encodeURIComponent(month)}`);
    setBusy(false);
    say(DOWNLOAD, result.ok ? `File downloaded: ${result.name}.` : result.message, result.ok ? "success" : "refusal");
  };

  return (
    <div class="screen">
      <section class="work">
        <div class="screen-head">
          <Heading>Regulator's monthly files</Heading>
          <p class="lede">One CSV per business month: every case created in it, with the rule and counterparty name it was decided under.</p>
        </div>
        {loaded.state === "loading" ? (
          <div class="skeleton" aria-busy="true"><span /><span /><span /></div>
        ) : (
          <div class="files-layout">
            {wide && (
              <div class="panel files-rail">
                <MonthPicker id="files-month" months={months} value={month} onChange={setPicked} />
                <ul class="plain-list files-months">
                  {months.map((m) => (
                    <li key={m.month} class={m.month === month ? "is-chosen" : undefined}>
                      <span>{formatMonth(m.month)}</span>
                      <span class="muted fig">{m.cases} {m.cases === 1 ? "case" : "cases"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div class="panel files-download">
              <h2>{month ? formatMonth(month) : "No month"}</h2>
              {!wide && (
                <Button onClick={() => setChoosing(true)}>
                  <Icon name="report" />
                  <span>Choose month</span>
                </Button>
              )}
              <p class="files-state">
                {chosen && chosen.cases === 0
                  ? `No transfers in ${formatMonth(chosen.month)}. The file has a header row only.`
                  : "Choose a month and download its file."}
              </p>
              {chosen && chosen.cases > 0 && (
                <p class="muted"><Fig>{chosen.cases}</Fig> {chosen.cases === 1 ? "case" : "cases"} · <Fig>{desk.workspace.slug}-regulator-{chosen.month}.csv</Fig></p>
              )}
              <div class="form-actions">
                <Button variant="primary" disabled={busy || !month} onClick={download}>
                  <Icon name="download" />
                  <span>Download file</span>
                </Button>
              </div>
              <ActionNote action={DOWNLOAD} />
              {desk.role === "support_agent" && <p class="field-hint">Your file carries masked personal data only.</p>}
            </div>
          </div>
        )}
      </section>
      {!wide && (
        <Dialog open={choosing} label="Choose month" kind="sheet" onClose={() => setChoosing(false)}>
          <MonthPicker id="files-month-sheet" months={months} value={month} onChange={setPicked} />
          <div class="form-actions">
            <Button variant="primary" onClick={() => setChoosing(false)}>Done</Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
