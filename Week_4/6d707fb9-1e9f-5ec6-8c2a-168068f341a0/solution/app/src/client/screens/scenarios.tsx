import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { COUNTRIES, MATERIALS, MEASURE_NAMES, MODES, modeName } from "../../shared/catalog";
import type { Line, Measure, Scenario, ScenarioChanges, ScenarioPreview, Style } from "../../shared/api";
import { announce, place, post, pushAddress, useMedia, usePause, useResource, useTitle } from "../lib";
import { Button, Field, Modal, Problems, Strata, TableFrame, useDialog, useForm, type DialogControl } from "../ui";
import { RefreshLine } from "../frame";
import { Heading, NotFound } from "./public";

/** The address holds the changes as recycled=, material=, factory= and mode=, each repeatable. */
function changesOfAddress(search: string): ScenarioChanges {
  const query = new URLSearchParams(search);
  const pairs = (key: string): [string, string][] => query.getAll(key).map((entry) => entry.split(":") as [string, string]);
  return {
    recycled: pairs("recycled").map(([lineId, percent]) => ({ lineId, percent: Number(percent) })),
    materialSwaps: pairs("material").map(([lineId, materialId]) => ({ lineId, materialId })),
    factorySwaps: pairs("factory").map(([lineId, country]) => ({ lineId, country })),
    legModes: pairs("mode").map(([legIndex, mode]) => ({ legIndex: Number(legIndex), mode })),
  };
}

function addressOfChanges(changes: ScenarioChanges): string {
  const query = new URLSearchParams();
  changes.recycled.filter((change) => change.percent > 0).forEach((change) => query.append("recycled", `${change.lineId}:${change.percent}`));
  changes.materialSwaps.forEach((change) => query.append("material", `${change.lineId}:${change.materialId}`));
  changes.factorySwaps.forEach((change) => query.append("factory", `${change.lineId}:${change.country}`));
  changes.legModes.forEach((change) => query.append("mode", `${change.legIndex}:${change.mode}`));
  const text = query.toString().replace(/%3A/g, ":");
  return text ? `?${text}` : "";
}

function SaveForm({ styleId, resultId, changes, control, onSaved }: { styleId: string; resultId: string; changes: ScenarioChanges; control: DialogControl; onSaved: () => Promise<void> }): JSX.Element {
  const form = useForm("save-scenario", { name: "" });
  const save = (event: Event): void => {
    event.preventDefault();
    void form.submit(async () => {
      await post<Scenario>(`/api/styles/${styleId}/scenarios`, { resultId, ...changes, name: form.values.name });
      await onSaved();
      control.hide();
      announce(`Scenario ${form.values.name} saved.`);
    });
  };
  return (
    <form onSubmit={save} noValidate>
      <h2>Save scenario</h2>
      <Problems form={form} />
      <Field form={form} name="name" label="Name" value={form.values.name} onValue={(value) => form.set("name", value)} />
      <div class="dialog-actions">
        <Button type="submit" green busy={form.busy}>
          Save
        </Button>
        <Button onPress={control.hide}>Close</Button>
      </div>
    </form>
  );
}

export function Scenarios({ id }: { id: string }): JSX.Element {
  const here = place.use();
  const style = useResource<Style>(`/api/styles/${id}`);
  const lines = useResource<{ lines: Line[] }>(`/api/styles/${id}/lines`);
  const saved = useResource<{ scenarios: Scenario[] }>(`/api/styles/${id}/scenarios`);
  const dialog = useDialog("save-scenario");
  const stacked = useMedia("(max-width: 767px)");
  const pause = usePause();
  const asked = useRef(0);
  const [preview, setPreview] = useState<ScenarioPreview | null>(null);
  const [changes, setChanges] = useState<ScenarioChanges>(() => changesOfAddress(here.search));
  const baseline = style.data?.latestResult ?? null;
  const baselineId = useRef<string | null>(null);
  const ownCommit = useRef<string | null>(null);
  const heading = style.data ? `Scenarios for ${style.data.name}` : "";
  useTitle(heading);

  if (baseline && !baselineId.current) baselineId.current = baseline.id;

  const ask = async (next: ScenarioChanges, resultId: string, say: boolean): Promise<void> => {
    const mine = (asked.current += 1);
    const answer = await post<ScenarioPreview>(`/api/styles/${id}/scenarios/preview`, { resultId, ...next });
    if (mine !== asked.current) return;
    setPreview(answer);
    if (say) {
      const climate = answer.measures.find((entry) => entry.measure === "climate") as Measure;
      announce(`Scenario climate total ${climate.totalShown}.`);
    }
  };

  // The first answer once the baseline is known, and Back or Forward through the address.
  useEffect(() => {
    if (!baseline) return;
    if (ownCommit.current === here.search) {
      ownCommit.current = null;
      return;
    }
    const fromAddress = changesOfAddress(here.search);
    setChanges(fromAddress);
    ask(fromAddress, baselineId.current ?? baseline.id, false).catch(() => undefined);
  }, [Boolean(baseline), here.search]);

  const change = (next: ScenarioChanges): void => {
    setChanges(next);
    pause(() => {
      ownCommit.current = addressOfChanges(next);
      pushAddress(ownCommit.current);
      if (baselineId.current) ask(next, baselineId.current, true).catch(() => undefined);
    });
  };

  if (style.missing) return <NotFound />;

  const scenarioClimate = preview?.measures.find((entry) => entry.measure === "climate");
  const baselineClimate = baseline?.measures.find((entry) => entry.measure === "climate");

  return (
    <main class="desk-main">
      <Heading>{heading}</Heading>
      <RefreshLine />
      <div class="screen-actions">
        <a class="cell-link" href={`/styles/${id}`}>
          Back to the style
        </a>
        <div class="action-bar">
          <Button green onPress={dialog.show}>
            Save scenario
          </Button>
        </div>
      </div>
      {baseline && baselineClimate ? (
        <>
          <section class="panel" aria-label="Changes">
            <h2>Changes</h2>
            <div class="change-grid">
              {(lines.data?.lines ?? []).map((line) => {
                const recycled = changes.recycled.find((entry) => entry.lineId === line.id)?.percent ?? 0;
                const material = changes.materialSwaps.find((entry) => entry.lineId === line.id)?.materialId ?? line.materialId;
                const factory = changes.factorySwaps.find((entry) => entry.lineId === line.id)?.country ?? line.tier1?.country ?? "";
                return (
                  <div key={line.id} class="change-group">
                    <h3>{line.materialName}</h3>
                    <div class="field">
                      <label for={`recycled-${line.id}`}>Recycled share for {line.materialName}</label>
                      <div class="slider-row">
                        <input
                          id={`recycled-${line.id}`}
                          type="range"
                          min={0}
                          max={100}
                          step={5}
                          value={recycled}
                          onInput={(event) => {
                            const percent = Number(event.currentTarget.value);
                            change({ ...changes, recycled: [...changes.recycled.filter((entry) => entry.lineId !== line.id), ...(percent ? [{ lineId: line.id, percent }] : [])] });
                          }}
                        />
                        <span class="figure">{recycled}%</span>
                      </div>
                    </div>
                    <div class="field">
                      <label for={`material-${line.id}`}>Material for {line.materialName}</label>
                      <select
                        id={`material-${line.id}`}
                        value={material}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          change({ ...changes, materialSwaps: [...changes.materialSwaps.filter((entry) => entry.lineId !== line.id), ...(value !== line.materialId ? [{ lineId: line.id, materialId: value }] : [])] });
                        }}
                      >
                        {MATERIALS.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div class="field">
                      <label for={`factory-${line.id}`}>Factory country for {line.materialName}</label>
                      <select
                        id={`factory-${line.id}`}
                        value={factory}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          change({ ...changes, factorySwaps: [...changes.factorySwaps.filter((entry) => entry.lineId !== line.id), ...(value !== line.tier1?.country ? [{ lineId: line.id, country: value }] : [])] });
                        }}
                      >
                        {COUNTRIES.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              })}
              {(style.data?.legs ?? []).map((leg, index) => (
                <div key={leg.id} class="change-group">
                  <h3>
                    Leg {index + 1}: {modeName(leg.mode)}
                  </h3>
                  <div class="field">
                    <label for={`mode-${index}`}>Mode for leg {index + 1}</label>
                    <select
                      id={`mode-${index}`}
                      value={changes.legModes.find((entry) => entry.legIndex === index)?.mode ?? leg.mode}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        change({ ...changes, legModes: [...changes.legModes.filter((entry) => entry.legIndex !== index), ...(value !== leg.mode ? [{ legIndex: index, mode: value }] : [])] });
                      }}
                    >
                      {MODES.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section class="panel" aria-label="Scenario band">
            <h2>Climate, with the baseline behind</h2>
            <Strata measure={scenarioClimate ?? baselineClimate} stacked={stacked} ghost={baselineClimate} />
          </section>
          <h2 class="section-heading">Comparison</h2>
          <TableFrame name="Comparison">
            <table>
              <thead>
                <tr>
                  <th scope="col">Measure</th>
                  <th scope="col" class="figure">
                    Baseline
                  </th>
                  <th scope="col" class="figure">
                    Scenario
                  </th>
                  <th scope="col" class="figure">
                    Difference
                  </th>
                </tr>
              </thead>
              <tbody>
                {baseline.measures.map((entry) => {
                  const scenario = preview?.measures.find((candidate) => candidate.measure === entry.measure);
                  const difference = preview?.differences.find((candidate) => candidate.measure === entry.measure);
                  return (
                    <tr key={entry.measure}>
                      <td>{MEASURE_NAMES[entry.measure]}</td>
                      <td class="figure">{entry.totalShown}</td>
                      <td class="figure">{scenario?.totalShown ?? entry.totalShown}</td>
                      <td class="figure">{difference?.shown ?? "no change"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableFrame>
          <section class="panel" aria-label="Saved scenarios">
            <h2>Saved scenarios</h2>
            {saved.data?.scenarios.length ? (
              <ul class="plain-list">
                {saved.data.scenarios.map((scenario) => (
                  <li key={scenario.id}>
                    <b>{scenario.name}</b>{" "}
                    <span class="figure">{scenario.measures.find((entry) => entry.measure === "climate")?.totalShown}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No saved scenarios yet.</p>
            )}
          </section>
        </>
      ) : style.data ? (
        <div class="empty-state">
          <div class="fragment fragment-empty" aria-hidden="true">
            <span class="fragment-stratum weave-materials" />
            <span class="fragment-stratum weave-use" />
          </div>
          <p>
            Work out the footprint first.{" "}
            <a class="text-link" href={`/styles/${id}`}>
              Open the style
            </a>
          </p>
        </div>
      ) : null}
      <Modal name="Save scenario" control={dialog}>
        <SaveForm styleId={id} resultId={baselineId.current ?? ""} changes={changes} control={dialog} onSaved={saved.reload} />
      </Modal>
    </main>
  );
}
