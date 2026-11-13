import { useEffect, useState } from "react";
import type { Settings } from "../../../shared/api";
import type { SizeUnit } from "../../../shared/sizes";
import { writtenDate } from "../../../shared/words";
import { ZONE_NAMES } from "../../../shared/zones";
import { api, ApiError } from "../api";
import { Segmented } from "../controls";
import { COPY, useDeck } from "../deck";
import { useField } from "../field";
import { unitName } from "../format";
import { useDocumentTitle } from "../hooks";
import { UNIT_OPTIONS } from "./capture";

export function SettingsScreen() {
  useDocumentTitle("Settings");
  const field = useField();
  const { say, unit, setUnit } = useDeck();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [zone, setZone] = useState("");
  const [zoneError, setZoneError] = useState<string | undefined>();

  useEffect(() => {
    field.show(null);
    return () => field.show(null);
  }, [field]);

  useEffect(() => {
    api<Settings>("GET", "/settings").then(
      (loaded) => {
        setSettings(loaded);
        setZone(loaded.pending_zone?.zone ?? loaded.home_zone);
      },
      () => say(COPY.generic),
    );
  }, [say]);

  const saveZone = async () => {
    setZoneError(undefined);
    try {
      const saved = await api<Settings>("PUT", "/settings/home-zone", { json: { zone } });
      setSettings(saved);
      setZone(saved.pending_zone?.zone ?? saved.home_zone);
      say(notice(saved));
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        setZoneError(error.fields.zone);
        say(COPY.checkFields);
      } else {
        say(COPY.generic);
      }
    }
  };

  const changeUnit = (next: SizeUnit) => {
    setUnit(next);
    api("PUT", "/settings/unit", { json: { unit: next } }).then(
      () => say(`Sizes now show in ${unitName(next)}.`),
      () => say(COPY.generic),
    );
  };

  return (
    <>
      <h1>Settings</h1>
      <div className="settings-form">
        <div className="field-row">
          <div className="label-line">
            <label htmlFor="home-zone">Home time zone</label>
          </div>
          <select
            id="home-zone"
            value={zone}
            aria-invalid={zoneError ? true : undefined}
            aria-describedby={zoneError ? "home-zone-error" : undefined}
            onChange={(event) => setZone(event.target.value)}
          >
            {ZONE_NAMES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          {zoneError && (
            <p id="home-zone-error" className="field-error">
              {zoneError}
            </p>
          )}
          {settings && <p className="muted">{notice(settings)}</p>}
        </div>
        <button type="button" className="btn primary" onClick={() => void saveZone()}>
          Save home zone
        </button>
        <div className="field-row">
          <span className="label-line">Size unit</span>
          <Segmented label="Size unit" name="settings-unit" value={unit} options={UNIT_OPTIONS} onChange={changeUnit} />
        </div>
      </div>
    </>
  );
}

function notice(settings: Settings): string {
  const pending = settings.pending_zone;
  return pending
    ? `Your home zone changes to ${pending.zone} at midnight on ${writtenDate(pending.effective_date)} in ${settings.home_zone}.`
    : `Your home zone is ${settings.home_zone}.`;
}
