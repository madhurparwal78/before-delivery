import { useCallback, useEffect, useState } from "react";
import { STAFF_COPY } from "../../../shared/copy.js";
import { EDITION, PLATES, type Plate } from "../../../shared/domain.js";
import { get } from "../api.js";
import { Button } from "../ui.js";
import { call, failureText, say } from "./desk.js";
import { StaffList, type Column } from "./List.js";
import type { Stock } from "./types.js";

/** Box 1 carries the first plate, box 2 the second, and so on; each box answers with its plate's art address. */
const firstBoxOf = (plate: Plate): number => PLATES.indexOf(plate) + 1;

/** One plate: its current art (when there is any) and the file picker that replaces it. */
const PlateRow = ({ plate }: { plate: Plate }) => {
  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState(0);
  const [art, setArt] = useState<string | null>(null);

  useEffect(() => {
    get<{ artUrl: string | null }>(`/api/boxes/${firstBoxOf(plate)}`).then(
      ({ body }) => setArt(body.artUrl),
      (error: unknown) => say(failureText(error), true),
    );
  }, [plate]);

  const upload = async (): Promise<void> => {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    try {
      const { body } = await call<{ artUrl: string }>("POST", `/api/staff/plates/${plate.toLowerCase()}/art`, { form });
      setVersion(version + 1);
      setArt(body.artUrl);
      setFile(null);
      say(STAFF_COPY.artSaved);
    } catch (error) {
      say(failureText(error), true);
    }
  };

  return (
    <div className="staff-upload">
      <div className="staff-art">
        {art === null ? <span className="muted">No art yet</span> : (
          <img src={version === 0 ? art : `${art}?v=${version}`} alt={`Current art for ${plate}`} onError={() => setArt(null)} />
        )}
      </div>
      <div className="field">
        <label htmlFor={`art-${plate}`}>Art file for {plate}</label>
        <input
          id={`art-${plate}`}
          key={version}
          type="file"
          accept="image/png,image/jpeg"
          data-motion="focus"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </div>
      <Button disabled={!file} onClick={() => void upload()}>Upload art for {plate}</Button>
    </div>
  );
};

const columns: Column<Plate>[] = [
  { header: "Plate", cell: (plate) => <strong>{plate}</strong> },
  { header: "Art", actions: true, cell: (plate) => <PlateRow plate={plate} /> },
];

export const PlatesPage = () => {
  const [stock, setStock] = useState<Stock | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setStock((await call<Stock>("GET", "/api/staff/stock")).body);
    } catch (error) {
      say(failureText(error), true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <dl className="staff-figures">
        <div className="staff-figure"><dt>Boxes left</dt><dd>{stock ? `${stock.remaining} of ${EDITION}` : ""}</dd></div>
        <div className="staff-figure"><dt>Low-stock alerts at</dt><dd>{stock ? stock.thresholds.join(", ") : ""}</dd></div>
      </dl>
      <StaffList label="Plates" rows={[...PLATES]} rowKey={(plate) => plate} columns={columns} />
    </>
  );
};
