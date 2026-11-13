import { useLayoutEffect as useEffect, useState } from "preact/hooks";
import { OPS_TEXT } from "../../../shared/copy";
import { dateText } from "../../../shared/format";
import type { EditionView } from "../../../shared/types";
import { get, post } from "../../api";
import { showAlert, showSuccess, startPending } from "../../messages";
import { leaveIfSignedOut, opsRefusal, refuse } from "../../ops";
import { OPS_REFUSALS } from "../../../shared/copy";

export function Editions() {
  const [editions, setEditions] = useState<EditionView[]>([]);
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [standard, setStandard] = useState("24");
  const [club, setClub] = useState("36");
  const [percent, setPercent] = useState("25");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = (): void => {
    void get<{ editions: EditionView[] }>("/api/ops/editions").then((result) => {
      if (result.data) setEditions(result.data.editions);
      else refuse(result);
    });
  };
  useEffect(load, []);

  const save = async (event: Event): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    startPending(OPS_TEXT.working);
    setFields({});
    const number = (text: string): number | string => (text.trim() === "" ? "" : Number(text));
    const result = await post<EditionView>("/api/ops/editions", {
      code, title, starts_on: startsOn, standard_months: number(standard), club_months: number(club), owner_contribution_percent: number(percent),
    });
    setBusy(false);
    if (result.data) {
      showSuccess(OPS_TEXT.editionSaved(result.data.code, result.data.starts_on));
      load();
      return;
    }
    if (leaveIfSignedOut(result)) return;
    const refused = result.error?.fields;
    if (refused) setFields(refused);
    showAlert(refused?.["starts_on"] === "must_be_future" ? OPS_REFUSALS.must_be_future : opsRefusal(result));
  };

  const problem = (field: string) => (fields[field] ? <p class="field-error">{fields[field] === "must_be_future" ? OPS_REFUSALS.must_be_future : fields[field]}</p> : null);

  return (
    <div class="stack">
      <h1 class="plate-title">Aftercare editions</h1>
      <form noValidate onSubmit={(event) => void save(event)} class="column-form" style={{ margin: 0 }}>
        <div class="field">
          <label for="edition-code">Edition code</label>
          <input id="edition-code" type="text" value={code} onInput={(event) => setCode(event.currentTarget.value)} />
          {problem("code")}
        </div>
        <div class="field">
          <label for="edition-title">Title</label>
          <input id="edition-title" type="text" value={title} onInput={(event) => setTitle(event.currentTarget.value)} />
          {problem("title")}
        </div>
        <div class="field">
          <label for="edition-starts">Starts on</label>
          <input id="edition-starts" type="date" value={startsOn} onInput={(event) => setStartsOn(event.currentTarget.value)} />
          {problem("starts_on")}
        </div>
        <div class="field">
          <label for="edition-standard">Standard months</label>
          <input id="edition-standard" type="number" value={standard} onInput={(event) => setStandard(event.currentTarget.value)} />
          {problem("standard_months")}
        </div>
        <div class="field">
          <label for="edition-club">Club months</label>
          <input id="edition-club" type="number" value={club} onInput={(event) => setClub(event.currentTarget.value)} />
          {problem("club_months")}
        </div>
        <div class="field">
          <label for="edition-percent">Owner contribution percent</label>
          <input id="edition-percent" type="number" value={percent} onInput={(event) => setPercent(event.currentTarget.value)} />
          {problem("owner_contribution_percent")}
        </div>
        <button type="submit" class="primary" disabled={busy}>
          Save edition
        </button>
      </form>
      <div class="table-region" role="region" aria-label="Editions" tabIndex={0}>
        <table aria-label="Editions">
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Title</th>
              <th scope="col">Starts on</th>
              <th scope="col">Standard</th>
              <th scope="col">Club</th>
              <th scope="col">Owner pays %</th>
            </tr>
          </thead>
          <tbody>
            {editions.map((edition) => (
              <tr key={edition.code}>
                <td class="mono">{edition.code}</td>
                <td>{edition.title}</td>
                <td>{dateText(edition.starts_on, "en-GB")}</td>
                <td class="mono">{edition.standard_months}</td>
                <td class="mono">{edition.club_months}</td>
                <td class="mono">{edition.owner_contribution_percent}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
