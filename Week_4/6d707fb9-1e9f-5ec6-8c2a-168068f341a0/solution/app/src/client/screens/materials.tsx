import type { JSX } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { COUNTRIES, MODES, modeName } from "../../shared/catalog";
import type { Line, Style, Tier } from "../../shared/api";
import { ApiFailure, announce, api, failureText, focusHeading, patch, post, remove, useAction, usePause, useResource, useTitle } from "../lib";
import { Button, Field, Hidden, Modal, Problems, useDialog, useForm, type DialogControl, type FormApi } from "../ui";
import { RefreshLine } from "../frame";
import { Heading, NotFound } from "./public";

const COUNTRY_OPTIONS = [{ value: "", label: "Not known yet" }, ...COUNTRIES.map((country) => ({ value: country.id, label: country.name }))];

const TIERS = [1, 2, 3] as const;

interface MaterialValues extends Record<string, unknown> {
  material: string;
  materialId: string;
  how: "area" | "plain";
  weight: string;
  area: string;
  mass: string;
  fibres: { name: string; sharePercent: string }[];
  tier1Factory: string;
  tier1Town: string;
  tier1Country: string;
  tier2Factory: string;
  tier2Town: string;
  tier2Country: string;
  tier3Factory: string;
  tier3Town: string;
  tier3Country: string;
}

function tierOf(values: MaterialValues, tier: 1 | 2 | 3): Tier | null {
  const factory = values[`tier${tier}Factory`] as string;
  const town = values[`tier${tier}Town`] as string;
  const country = values[`tier${tier}Country`] as string;
  if (!factory.trim() && !town.trim() && !country) return null;
  return { factory, town, country: country || null };
}

function MaterialCombobox({ form }: { form: FormApi<MaterialValues> }): JSX.Element {
  const [options, setOptions] = useState<{ id: string; name: string }[] | null>(null);
  const [active, setActive] = useState(-1);
  const asked = useRef(0);
  const pause = usePause();
  const open = options !== null;

  const search = (text: string): void => {
    const mine = (asked.current += 1);
    pause(() => {
      void api<{ materials: { id: string; name: string }[] }>(`/api/materials?q=${encodeURIComponent(text)}`).then((answer) => {
        if (mine !== asked.current) return;
        setOptions(answer.materials);
        setActive(-1);
      });
    });
  };

  const pickOption = (option: { id: string; name: string }): void => {
    asked.current += 1;
    form.set("material", option.name);
    form.set("materialId", option.id);
    setOptions(null);
  };

  return (
    <div class="field combobox">
      <label for="field-materialId">Material</label>
      <input
        id="field-materialId"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open ? "true" : "false"}
        aria-controls="material-options"
        aria-activedescendant={active >= 0 ? `material-option-${active}` : undefined}
        aria-invalid={form.problems.fields.materialId ? "true" : undefined}
        autoComplete="off"
        value={form.values.material}
        onInput={(event) => {
          form.set("material", event.currentTarget.value);
          form.set("materialId", "");
          search(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            asked.current += 1;
            setOptions(null);
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!options) {
              search(form.values.material);
              return;
            }
            const size = options.length;
            if (size) setActive((active + (event.key === "ArrowDown" ? 1 : size - 1) + (active < 0 && event.key === "ArrowUp" ? 1 : 0)) % size);
          } else if (event.key === "Enter" && open) {
            event.preventDefault();
            const option = options?.[active] ?? options?.[0];
            if (option) pickOption(option);
            else setOptions(null);
          }
        }}
      />
      {open ? (
        <ul id="material-options" class="listbox" role="listbox" aria-label="Materials">
          {options.map((option, index) => (
            <li
              key={option.id}
              id={`material-option-${index}`}
              role="option"
              aria-selected={index === active ? "true" : "false"}
              class={index === active ? "is-active" : undefined}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => pickOption(option)}
            >
              {option.name}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function MaterialForm({ styleId, baseVersion, line, control, onSaved }: { styleId: string; baseVersion: number; line: Line | null; control: DialogControl; onSaved: (line: Line) => Promise<void> }): JSX.Element {
  const form = useForm<MaterialValues>(line ? null : "add-material", {
    material: line?.materialName ?? "",
    materialId: line?.materialId ?? "",
    how: line && !line.fabricWeightGsm ? "plain" : "area",
    weight: line?.fabricWeightGsm ?? "",
    area: line?.areaM2 ?? "",
    mass: line && !line.fabricWeightGsm ? line.massGrams : "",
    fibres: line?.fibres ?? [{ name: "", sharePercent: "" }],
    tier1Factory: line?.tier1?.factory ?? "",
    tier1Town: line?.tier1?.town ?? "",
    tier1Country: line?.tier1?.country ?? "",
    tier2Factory: line?.tier2?.factory ?? "",
    tier2Town: line?.tier2?.town ?? "",
    tier2Country: line?.tier2?.country ?? "",
    tier3Factory: line?.tier3?.factory ?? "",
    tier3Town: line?.tier3?.town ?? "",
    tier3Country: line?.tier3?.country ?? "",
  });
  const version = useRef(baseVersion);
  const { values } = form;

  const save = (event: Event): void => {
    event.preventDefault();
    void form.submit(async () => {
      const body = {
        materialId: values.materialId,
        ...(values.how === "plain" ? { massGrams: values.mass } : { fabricWeightGsm: values.weight, areaM2: values.area }),
        fibres: values.fibres,
        tier1: tierOf(values, 1),
        tier2: tierOf(values, 2),
        tier3: tierOf(values, 3),
        baseVersion: version.current,
      };
      const saved = line ? await patch<Line>(`/api/styles/${styleId}/lines/${line.id}`, body) : await post<Line>(`/api/styles/${styleId}/lines`, body);
      await onSaved(saved);
      control.hide();
      announce(line ? `${saved.materialName} saved.` : `${saved.materialName} added.`);
    });
  };

  const setFibre = (index: number, key: "name" | "sharePercent", value: string): void => {
    form.set("fibres", values.fibres.map((fibre, at) => (at === index ? { ...fibre, [key]: value } : fibre)));
  };

  return (
    <form onSubmit={save} noValidate>
      <h2>{line ? "Edit material" : "Add material"}</h2>
      <Problems form={form} aliases={{ fibres: "fibres.0.sharePercent", massGrams: values.how === "plain" ? "massGrams" : "fabricWeightGsm" }} />
      <MaterialCombobox form={form} />
      <fieldset class="chips" role="radiogroup" aria-label="How to give the mass">
        <legend>How to give the mass</legend>
        <label class="chip">
          <input type="radio" name="how" checked={values.how === "area"} onChange={() => form.set("how", "area")} />
          <span>Fabric weight and area</span>
        </label>
        <label class="chip">
          <input type="radio" name="how" checked={values.how === "plain"} onChange={() => form.set("how", "plain")} />
          <span>Plain mass</span>
        </label>
      </fieldset>
      {values.how === "area" ? (
        <>
          <Field form={form} name="fabricWeightGsm" label="Fabric weight (g/m²)" inputMode="decimal" aliasOf={["massGrams"]} value={values.weight} onValue={(value) => form.set("weight", value)} />
          <Field form={form} name="areaM2" label="Area (m²)" inputMode="decimal" value={values.area} onValue={(value) => form.set("area", value)} />
        </>
      ) : (
        <Field form={form} name="massGrams" label="Mass (g)" inputMode="decimal" value={values.mass} onValue={(value) => form.set("mass", value)} />
      )}
      {values.fibres.map((fibre, index) => (
        <div key={index} class="field-pair">
          <Field form={form} name={`fibres.${index}.name`} label={`Fibre ${index + 1} name`} value={fibre.name} onValue={(value) => setFibre(index, "name", value)} />
          <Field form={form} name={`fibres.${index}.sharePercent`} label={`Fibre ${index + 1} share (%)`} inputMode="decimal" aliasOf={index === 0 ? ["fibres"] : []} value={fibre.sharePercent} onValue={(value) => setFibre(index, "sharePercent", value)} />
        </div>
      ))}
      <Button onPress={() => form.set("fibres", [...values.fibres, { name: "", sharePercent: "" }])}>Add fibre</Button>
      {TIERS.map((tier) => (
        <fieldset key={tier} class="tier">
          <legend>Tier {tier}</legend>
          <Field form={form} name={`tier${tier}.factory`} label={`Tier ${tier} factory`} value={values[`tier${tier}Factory`] as string} onValue={(value) => form.set(`tier${tier}Factory`, value)} />
          <Field form={form} name={`tier${tier}.town`} label={`Tier ${tier} town`} value={values[`tier${tier}Town`] as string} onValue={(value) => form.set(`tier${tier}Town`, value)} />
          <Field form={form} name={`tier${tier}.country`} label={`Tier ${tier} country`} options={COUNTRY_OPTIONS} value={values[`tier${tier}Country`] as string} onValue={(value) => form.set(`tier${tier}Country`, value)} />
        </fieldset>
      ))}
      <div class="dialog-actions">
        <Button type="submit" green busy={form.busy}>
          Save material
        </Button>
        <Button onPress={control.hide}>Close</Button>
      </div>
    </form>
  );
}

function LegForm({ styleId, baseVersion, control, onSaved }: { styleId: string; baseVersion: number; control: DialogControl; onSaved: () => Promise<void> }): JSX.Element {
  const form = useForm("add-leg", { mode: "road", km: "" });
  const version = useRef(baseVersion);
  const save = (event: Event): void => {
    event.preventDefault();
    void form.submit(async () => {
      await post(`/api/styles/${styleId}/legs`, { mode: form.values.mode, km: form.values.km, baseVersion: version.current });
      await onSaved();
      control.hide();
      announce("Transport leg added.");
    });
  };
  return (
    <form onSubmit={save} noValidate>
      <h2>Add leg</h2>
      <Problems form={form} />
      <Field form={form} name="mode" label="Mode" options={MODES.map((mode) => ({ value: mode.id, label: mode.name }))} value={form.values.mode} onValue={(value) => form.set("mode", value)} />
      <Field form={form} name="km" label="Distance (km)" inputMode="decimal" value={form.values.km} onValue={(value) => form.set("km", value)} />
      <div class="dialog-actions">
        <Button type="submit" green busy={form.busy}>
          Save leg
        </Button>
        <Button onPress={control.hide}>Close</Button>
      </div>
    </form>
  );
}

function tierLine(tier: Tier | null, index: number): string | null {
  return tier ? `Tier ${index}: ${[tier.factory, tier.town].filter(Boolean).join(", ")}${tier.country ? ` (${COUNTRIES.find((country) => country.id === tier.country)?.name})` : ""}` : null;
}

function LineItem({ line, total, onMove, onEdit, onRemove, pending }: { line: Line; total: number; onMove: (line: Line, direction: "up" | "down", control: string) => void; onEdit: (line: Line, event: Event) => void; onRemove: (line: Line) => void; pending: string | null }): JSX.Element {
  const onKey = (event: KeyboardEvent): void => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    const direction = event.key === "ArrowUp" ? "up" : "down";
    if ((direction === "up" && line.position === 1) || (direction === "down" && line.position === total)) return;
    onMove(line, direction, (document.activeElement as HTMLElement).dataset.control ?? "down");
  };
  return (
    <li class="line" aria-label={line.materialName} onKeyDown={onKey}>
      <div class="line-facts">
        <p class="line-title">
          <span class="line-position">{line.position}</span> {line.materialName} <b class="figure">{line.massShown}</b>
        </p>
        <p>{line.fibres.map((fibre) => `${fibre.name} ${fibre.sharePercent}%`).join(", ")}</p>
        {[line.tier1, line.tier2, line.tier3].map((tier, index) => {
          const text = tierLine(tier, index + 1);
          return text ? <p key={index}>{text}</p> : null;
        })}
      </div>
      <div class="line-controls">
        <Button data-line={line.id} data-control="up" busy={pending === "up"} inactive={line.position === 1} onPress={() => onMove(line, "up", "up")}>
          Move up
        </Button>
        <Button data-line={line.id} data-control="down" busy={pending === "down"} inactive={line.position === total} onPress={() => onMove(line, "down", "down")}>
          Move down
        </Button>
        <Button data-line={line.id} data-control="edit" onPress={(event) => onEdit(line, event)}>
          Edit
        </Button>
        <Button data-line={line.id} data-control="remove" onPress={() => onRemove(line)}>
          Remove
        </Button>
      </div>
    </li>
  );
}

export function Materials({ id }: { id: string }): JSX.Element {
  const lines = useResource<{ lines: Line[]; version: number }>(`/api/styles/${id}/lines`);
  const style = useResource<Style>(`/api/styles/${id}`);
  const addMaterial = useDialog("add-material");
  const editMaterial = useDialog();
  const addLeg = useDialog("add-leg");
  const [editing, setEditing] = useState<Line | null>(null);
  const [pending, setPending] = useState<{ lineId: string; control: string } | null>(null);
  const [flat, setFlat] = useState<string | null>(null);
  const [, run] = useAction();
  const restoreTo = useRef<string | null>(null);
  const heading = style.data ? `Materials for ${style.data.name}` : "";
  useTitle(heading);

  useLayoutEffect(() => {
    if (restoreTo.current) {
      document.querySelector<HTMLElement>(restoreTo.current)?.focus();
      restoreTo.current = null;
    }
  });

  if (lines.missing) return <NotFound />;

  const reloadAll = async (): Promise<void> => {
    await Promise.all([lines.reload(), style.reload()]);
  };

  const fail = (error: unknown): void => {
    if (error instanceof ApiFailure && error.status === 401) return;
    const message = failureText(error);
    setFlat(message);
    announce(message);
  };

  const move = (line: Line, direction: "up" | "down", control: string): void => {
    void run(async () => {
      setFlat(null);
      setPending({ lineId: line.id, control: direction });
      try {
        const answer = await post<{ lines: Line[]; position: number; total: number; version: number }>(`/api/styles/${id}/lines/${line.id}/move`, { direction, baseVersion: lines.data?.version });
        restoreTo.current = `[data-line="${line.id}"][data-control="${control}"]`;
        await reloadAll();
        announce(`${line.materialName} moved to position ${answer.position} of ${answer.total}.`);
      } catch (error) {
        fail(error);
        await reloadAll().catch(() => undefined);
      } finally {
        setPending(null);
      }
    });
  };

  const removeLine = (line: Line): void => {
    void run(async () => {
      setFlat(null);
      try {
        await remove(`/api/styles/${id}/lines/${line.id}?baseVersion=${lines.data?.version}`);
        await reloadAll();
        focusHeading();
        announce(`${line.materialName} removed.`);
      } catch (error) {
        fail(error);
      }
    });
  };

  const removeLeg = (legId: string): void => {
    void run(async () => {
      setFlat(null);
      try {
        await remove(`/api/styles/${id}/legs/${legId}?baseVersion=${lines.data?.version}`);
        await reloadAll();
        focusHeading();
        announce("Transport leg removed.");
      } catch (error) {
        fail(error);
      }
    });
  };

  const total = lines.data?.lines.length ?? 0;

  return (
    <main class="desk-main">
      <Heading>{heading}</Heading>
      <RefreshLine />
      {flat ? <p class="stone-band">{flat}</p> : null}
      {style.settled && lines.settled ? (
        <>
          <div class="screen-actions">
            <a class="cell-link" href={`/styles/${id}`}>
              Back to the style
            </a>
            <div class="action-bar">
              <Button green onPress={addMaterial.show}>
                Add material
              </Button>
            </div>
          </div>
          {total ? (
            <ol class="lines">
              {lines.data?.lines.map((line) => (
                <LineItem
                  key={line.id}
                  line={line}
                  total={total}
                  onMove={move}
                  onEdit={(chosen, event) => {
                    setEditing(chosen);
                    editMaterial.show(event);
                  }}
                  onRemove={removeLine}
                  pending={pending?.lineId === line.id ? pending.control : null}
                />
              ))}
            </ol>
          ) : lines.data ? (
            <div class="empty-state">
              <div class="fragment fragment-empty" aria-hidden="true">
                <span class="fake-button">Add material</span>
              </div>
              <p>No material lines yet. Press Add material to add the first one.</p>
            </div>
          ) : null}
          <section class="panel" aria-label="Transport legs">
            <div class="panel-head">
              <h2>Transport legs</h2>
              <Button onPress={addLeg.show}>Add leg</Button>
            </div>
            <ul class="plain-list legs">
              {(style.data?.legs ?? []).map((leg) => (
                <li key={leg.id} aria-label={`${modeName(leg.mode)} ${leg.km} km`}>
                  <span>
                    {modeName(leg.mode)} · <span class="figure">{leg.km} km</span>
                  </span>
                  <Button onPress={() => removeLeg(leg.id)}>
                    Remove leg
                    <Hidden> {modeName(leg.mode)}</Hidden>
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
      <Modal name="Add material" control={addMaterial}>
        <MaterialForm styleId={id} baseVersion={lines.data?.version ?? 0} line={null} control={addMaterial} onSaved={reloadAll} />
      </Modal>
      <Modal name="Edit material" control={editMaterial}>
        <MaterialForm key={editing?.id} styleId={id} baseVersion={lines.data?.version ?? 0} line={editing} control={editMaterial} onSaved={reloadAll} />
      </Modal>
      <Modal name="Add leg" control={addLeg}>
        <LegForm styleId={id} baseVersion={lines.data?.version ?? 0} control={addLeg} onSaved={reloadAll} />
      </Modal>
    </main>
  );
}
