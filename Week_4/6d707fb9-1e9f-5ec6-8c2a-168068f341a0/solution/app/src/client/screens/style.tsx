import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  MEASURES,
  MEASURE_NAMES,
  STAGES,
  STAGE_NAMES,
  countryName,
  materialName,
  modeName,
  type MeasureId,
  type StageId,
} from "../../shared/catalog";
import type { Dossier, FactorRow, Measure, PassportRow, Result, Style } from "../../shared/api";
import { shownDate, wallTime } from "../../shared/time";
import { ApiFailure, announce, api, download, failureText, place, post, useAction, useMedia, useResource, useTitle } from "../lib";
import { Button, Modal, RollingFigure, Strata, measureLine, useDialog } from "../ui";
import { RefreshLine } from "../frame";
import { Heading, NotFound } from "./public";

const STYLE_STATES: Record<Style["state"], string> = { draft: "Draft", worked: "Worked", published: "Published", archived: "Archived" };

/** A button that stays: reads Working… while its request is open, focus and all. */
function ActionButton({ name, green, action, setFlat }: { name: string; green?: boolean; action: () => Promise<string | null>; setFlat: (text: string | null) => void }): JSX.Element {
  const [busy, run] = useAction();
  return (
    <Button
      green={green}
      busy={busy}
      onPress={() =>
        void run(async () => {
          setFlat(null);
          try {
            const message = await action();
            if (message) announce(message);
          } catch (error) {
            if (error instanceof ApiFailure && error.status === 401) return;
            const message = failureText(error);
            setFlat(message);
            announce(message);
          }
        })
      }
    >
      {name}
    </Button>
  );
}

function rowName(row: FactorRow): string {
  switch (row.kind) {
    case "material":
      return materialName(row.id);
    case "grid":
      return countryName(row.id);
    case "mode":
      return modeName(row.id);
    case "use":
      return "Wash";
    default:
      return "Disposal";
  }
}

function FactorsContent({ result, measure, stage, onNext, onClose }: { result: Result; measure: MeasureId; stage: StageId; onNext: () => void; onClose: () => void }): JSX.Element {
  const [rows, setRows] = useState<{ stage: StageId; edition: string; rows: FactorRow[] } | null>(null);
  useEffect(() => {
    let live = true;
    void api<{ edition: string; rows: FactorRow[] }>(`/api/results/${result.id}/factors?measure=${measure}&stage=${stage}`).then((answer) => {
      if (live) setRows({ stage, ...answer });
    });
    return () => {
      live = false;
    };
  }, [result.id, measure, stage]);
  return (
    <div class="factors">
      <h2>Factors for {STAGE_NAMES[stage]}</h2>
      <p>Factor edition {result.edition}</p>
      {rows ? (
        <ul>
          {rows.rows.map((row) => (
            <li key={row.id}>
              {rowName(row)}: {row.value} {row.unit}
            </li>
          ))}
        </ul>
      ) : null}
      <div class="dialog-actions">
        <Button onPress={onNext}>Next stage</Button>
        <Button onPress={onClose}>Close</Button>
      </div>
    </div>
  );
}

function FootprintPanel({ shownResult, isOldResult, actionSlot }: { shownResult: Result | null; isOldResult: boolean; actionSlot: JSX.Element }): JSX.Element {
  const [measureId, setMeasureId] = useState<MeasureId>("climate");
  const [stage, setStage] = useState<StageId>("materials");
  const popover = useDialog();
  const stacked = useMedia("(max-width: 767px)");
  const group = useRef<HTMLDivElement>(null);
  const measure = shownResult?.measures.find((entry) => entry.measure === measureId) as Measure | undefined;

  const choose = (next: MeasureId): void => {
    if (next === measureId) return;
    setMeasureId(next);
    const entry = shownResult?.measures.find((candidate) => candidate.measure === next);
    if (entry) announce(measureLine(entry));
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Enter" && measure) {
      event.preventDefault();
      setStage(measure.hotspot);
      popover.show();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const next = event.key === "Home" ? MEASURES[0] : MEASURES[MEASURES.length - 1];
      choose(next as MeasureId);
      group.current?.querySelector<HTMLInputElement>(`input[value="${next}"]`)?.focus();
    }
  };

  const openStage = (next: StageId, event: Event): void => {
    setStage(next);
    popover.show(event);
    popover.opener.current = group.current?.querySelector<HTMLElement>("input:checked") ?? null;
  };

  return (
    <section class="panel footprint-panel" aria-label="Footprint">
      <div class="panel-head">
        <h2>Footprint</h2>
        {actionSlot}
      </div>
      {shownResult && measure ? (
        <>
          <p class="panel-note">
            Factor edition {shownResult.edition} · Data quality {shownResult.dataQualityGrade} ({shownResult.dataQualityPercent}%)
            {isOldResult ? " · An earlier result" : ""}
          </p>
          <div ref={group} class="measures" role="radiogroup" aria-label="Measure" onKeyDown={onKey}>
            {MEASURES.map((id) => (
              <label key={id} class="measure-choice">
                <input type="radio" name="measure" value={id} checked={measureId === id} onChange={() => choose(id)} />
                <span>{MEASURE_NAMES[id]}</span>
              </label>
            ))}
          </div>
          <Strata measure={measure} stacked={stacked} onStage={openStage} />
          <div class="total-line">
            <p class="total">
              Total <RollingFigure text={measure.totalShown} part="total-figure" />
            </p>
            <p class="total-hotspot">Hotspot: {STAGE_NAMES[measure.hotspot]}</p>
          </div>
          <Modal name={`Factors for ${STAGE_NAMES[stage]}`} control={popover} kind="popover" dismissOutside>
            <FactorsContent
              result={shownResult}
              measure={measureId}
              stage={stage}
              onNext={() => setStage(STAGES[(STAGES.indexOf(stage) + 1) % STAGES.length] as StageId)}
              onClose={popover.hide}
            />
          </Modal>
        </>
      ) : (
        <div class="empty-state">
          <div class="fragment fragment-empty" aria-hidden="true">
            <span class="fragment-stratum weave-materials" />
            <span class="fragment-stratum weave-making" />
            <span class="fragment-stratum weave-use" />
          </div>
          <p>No footprint yet. Work out footprint is the first action.</p>
        </div>
      )}
    </section>
  );
}

export function StylePage({ id }: { id: string }): JSX.Element {
  const here = place.use();
  const resultId = new URLSearchParams(here.search).get("result");
  const styleResource = useResource<Style>(`/api/styles/${id}`);
  const results = useResource<{ results: Result[] }>(`/api/styles/${id}/results`);
  const dossiers = useResource<{ dossiers: Dossier[] }>(`/api/styles/${id}/dossiers`);
  const passports = useResource<{ passports: PassportRow[] }>("/api/passports");
  const [flat, setFlat] = useState<string | null>(null);
  const [newerShown, setNewerShown] = useState<string | null>(null);
  const style = styleResource.data;
  useTitle(style?.name);

  if (styleResource.missing) return <NotFound />;

  const reloadAll = async (): Promise<void> => {
    await Promise.all([styleResource.reload(), results.reload(), dossiers.reload(), passports.reload()]);
  };

  const shownResult = resultId ? (results.data?.results.find((result) => result.id === resultId) ?? null) : (style?.latestResult ?? null);
  const score = style?.score;
  const newer = style?.newerFactors ?? newerShown;
  const passportRows = (passports.data?.passports ?? []).filter((row) => row.styleId === id);
  const livePassport = passportRows.find((row) => row.state === "published");
  const latestDossier = dossiers.data?.dossiers[0];
  const dossierState =
    latestDossier &&
    (latestDossier.state === "ready"
      ? "Ready"
      : latestDossier.state === "making"
        ? "Making"
        : latestDossier.state === "replaced"
          ? "Replaced"
          : `Signed off by ${latestDossier.signedOffBy} on ${shownDate(latestDossier.signedOffAt as string)}`);
  const earlier = (results.data?.results ?? []).filter((result) => result.id !== style?.latestResult?.id);

  return (
    <main class="desk-main">
      <Heading>{style?.name ?? ""}</Heading>
      <RefreshLine />
      {style && results.settled && dossiers.settled && passports.settled ? (
        <>
          <div class="style-head">
            <p>
              {style.labelName} · GTIN {style.gtin} · {style.garment === "tshirt" ? "T-shirt" : style.garment === "shirt" ? "Shirt" : style.garment === "jeans" ? "Jeans" : "Coat"} · {STYLE_STATES[style.state]}
            </p>
            <div class="link-row">
              <a class="cell-link" href={`/styles/${id}/materials`}>
                Materials
              </a>
              <a class="cell-link" href={`/styles/${id}/scenarios`}>
                Scenarios
              </a>
            </div>
          </div>
          {flat ? <p class="stone-band">{flat}</p> : null}
          {newer ? <p class="stone-band">Newer factors available ({newer}).</p> : null}
          <FootprintPanel
            shownResult={shownResult}
            isOldResult={Boolean(resultId && shownResult && !shownResult.current)}
            actionSlot={
              <div class="panel-actions">
                <ActionButton
                  name="Check for newer factors"
                  setFlat={setFlat}
                  action={async () => {
                    await post("/api/factors/check");
                    const fresh = await api<Style>(`/api/styles/${id}`);
                    await styleResource.reload();
                    setNewerShown(fresh.newerFactors);
                    return fresh.newerFactors ? `Newer factors available (${fresh.newerFactors}).` : "No newer factors.";
                  }}
                />
                <div class="action-bar">
                  <ActionButton
                    name="Work out footprint"
                    green
                    setFlat={setFlat}
                    action={async () => {
                      const result = await post<Result>(`/api/styles/${id}/results`);
                      await reloadAll();
                      return `Footprint worked out with edition ${result.edition}.`;
                    }}
                  />
                </div>
              </div>
            }
          />
          <section class="panel" aria-label="Score">
            <div class="panel-head">
              <h2>Textile score</h2>
              <ActionButton
                name="Ask for score"
                setFlat={setFlat}
                action={async () => {
                  try {
                    const answer = await post<Style["score"]>(`/api/styles/${id}/score`);
                    await styleResource.reload();
                    return answer.shown;
                  } catch (error) {
                    await styleResource.reload().catch(() => undefined);
                    throw error;
                  }
                }}
              />
            </div>
            {score?.shown ? <p>{score.shown}</p> : <p>No score yet.</p>}
            {score?.state === "outdated" ? <p class="state-word">Outdated</p> : null}
            {score?.worstCaseFacts.includes("repairService") ? <p>Worst-case value used for repair service.</p> : null}
            {score?.worstCaseFacts.includes("rangeSize") ? <p>Worst-case value used for range size.</p> : null}
            {score?.state === "busy" && score.busyUntil ? <p class="stone-text">The score service is busy. You can try again at {wallTime(score.busyUntil)} Lisbon time.</p> : null}
          </section>
          <section class="panel" aria-label="Dossier">
            <div class="panel-head">
              <h2>Dossier</h2>
              <div class="panel-actions">
                <ActionButton
                  name="Make dossier"
                  setFlat={setFlat}
                  action={async () => {
                    await post<Dossier>(`/api/styles/${id}/dossiers`);
                    await dossiers.reload();
                    return "Dossier ready.";
                  }}
                />
                {latestDossier ? (
                  <>
                    <DownloadButton name="Download dossier" path={`/api/dossiers/${latestDossier.id}/file`} done="Dossier downloaded." fileName="dossier.pdf" setFlat={setFlat} />
                    <ActionButton
                      name="Send sign-off page"
                      setFlat={setFlat}
                      action={async () => {
                        await post(`/api/dossiers/${latestDossier.id}/sign-off-page`);
                        const label = await api<{ contactName: string }>(`/api/labels/${style.labelId}`);
                        return `Sign-off page sent to ${label.contactName}.`;
                      }}
                    />
                  </>
                ) : null}
                <DownloadButton name="Download results file" path={`/api/styles/${id}/results-file`} done="Results file downloaded." fileName="results.csv" setFlat={setFlat} />
              </div>
            </div>
            {dossierState ? <p>{dossierState}</p> : <p>No dossier yet.</p>}
          </section>
          <section class="panel" aria-label="Passport">
            <div class="panel-head">
              <h2>Passport</h2>
              <ActionButton
                name={passportRows.length ? "Publish correction" : "Publish passport"}
                setFlat={setFlat}
                action={async () => {
                  const made = await post<{ edition: number }>(`/api/styles/${id}/passport`);
                  await reloadAll();
                  return `Passport edition ${made.edition} published.`;
                }}
              />
            </div>
            {livePassport ? (
              <p>
                Edition {livePassport.edition}, published {shownDate(livePassport.publishedAt)}.{" "}
                <a class="text-link" href={livePassport.address}>
                  Read the passport
                </a>
              </p>
            ) : passportRows.length ? (
              <p>Withdrawn</p>
            ) : (
              <p>Not published yet.</p>
            )}
          </section>
          {earlier.length ? (
            <section class="panel" aria-label="Earlier results">
              <h2>Earlier results</h2>
              <ul class="plain-list">
                {earlier.map((result) => (
                  <li key={result.id}>
                    <a class="cell-link" href={`/styles/${id}?result=${result.id}`}>
                      {shownDate(result.workedOutAt)}, edition {result.edition}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}

function DownloadButton({ name, path, done, fileName, setFlat }: { name: string; path: string; done: string; fileName: string; setFlat: (text: string | null) => void }): JSX.Element {
  return (
    <Button
      onPress={() => {
        setFlat(null);
        download(path, fileName)
          .then(() => announce(done))
          .catch((error: unknown) => {
            const message = failureText(error);
            setFlat(message);
            announce(message);
          });
      }}
    >
      {name}
    </Button>
  );
}
