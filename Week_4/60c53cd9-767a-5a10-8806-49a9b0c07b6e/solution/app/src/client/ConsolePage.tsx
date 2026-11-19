/** /console: the sales coordinator's floor bands, unit editor with price versions and photographs, and active holds. */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ConsoleHold, ConsoleUnit, PriceVersion } from "../shared/api-types.js";
import { COPY } from "../shared/copy.js";
import { BANDS, STATUS_LABEL, type CellStatus } from "../shared/domain.js";
import { api, errorOf, NetworkError, type ApiResult } from "./api.js";
import { useAuth } from "./auth.js";
import { Modal } from "./dialogs.js";
import { dollars, officeTime } from "./format.js";
import { useNotify } from "./notices.js";
import { Link } from "./router.js";

/** A field message when the API names one (422), otherwise its message. */
const failureText = (result: ApiResult<unknown>): string => {
  const error = errorOf(result);
  const fields = error?.fields ? Object.values(error.fields) : [];
  return fields.length > 0 ? fields.join(" ") : (error?.message ?? "");
};

const Refusal = (): ReactNode => (
  <main className="console">
    <h1>Your account can&apos;t do that.</h1>
    <p>
      <Link to="/finder" className="button">
        Open the finder
      </Link>
    </p>
  </main>
);

export const ConsolePage = (): ReactNode => {
  const { account, ready, openSignIn } = useAuth();
  useEffect(() => {
    if (ready && !account) openSignIn({ title: "Sign in" });
  }, [ready, account, openSignIn]);
  if (!ready || !account) return <main className="console" aria-busy={!ready} />;
  if (account.role !== "coordinator") return <Refusal />;
  return <Console />;
};

type Busy = "release" | "price" | "photo" | "withdraw" | "convert" | null;

const BUSY_TEXT: Record<Exclude<Busy, null>, string> = {
  release: "Releasing...",
  price: "Saving...",
  photo: "Uploading...",
  withdraw: "Withdrawing...",
  convert: "Converting...",
};

const Console = (): ReactNode => {
  const notify = useNotify();
  const [units, setUnits] = useState<ConsoleUnit[]>([]);
  const [holds, setHolds] = useState<ConsoleHold[]>([]);
  const [lookup, setLookup] = useState("");
  const [versions, setVersions] = useState<PriceVersion[] | null>(null);
  const [price, setPrice] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState("");
  const [bandMessage, setBandMessage] = useState("");
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const withdrawButton = useRef<HTMLButtonElement>(null);

  const load = useCallback(async (): Promise<void> => {
    const [u, h] = await Promise.all([
      api<{ units: ConsoleUnit[] }>("GET", "/api/console/units"),
      api<{ holds: ConsoleHold[] }>("GET", "/api/console/holds"),
    ]);
    if (u.ok) setUnits(u.body.units);
    if (h.ok) setHolds(h.body.holds);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const code = lookup.trim().toUpperCase();
  const unit = useMemo(() => units.find((candidate) => candidate.code === code) ?? null, [units, code]);
  const unitCode = unit?.code ?? null;

  const loadVersions = useCallback(async (target: string): Promise<void> => {
    const result = await api<{ versions: PriceVersion[] }>("GET", `/api/console/units/${target}/prices`);
    if (result.ok) setVersions(result.body.versions);
  }, []);

  useEffect(() => {
    setMessage("");
    setFile(null);
    setVersions(null);
    if (unitCode) void loadVersions(unitCode);
  }, [unitCode, loadVersions]);

  useEffect(() => {
    if (unit) setPrice(String(unit.price));
    // The price box is reloaded when a different unit is chosen or its saved price changes.
  }, [unitCode, unit?.price]);

  const unreleased = BANDS.filter((band) => units.some((candidate) => candidate.band === band && candidate.status === "unreleased"));

  const run = async (kind: Exclude<Busy, null>, action: () => Promise<string | null>, onError: (text: string) => void): Promise<void> => {
    setBusy(kind);
    try {
      const failure = await action();
      if (failure !== null) onError(failure);
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      onError(COPY.lostReply);
    } finally {
      setBusy(null);
    }
  };

  const releaseBand = (band: string): Promise<void> =>
    run(
      "release",
      async () => {
        setBandMessage("");
        const result = await api("POST", `/api/console/bands/${band}/release`, { json: {} });
        if (!result.ok) return failureText(result);
        notify(`Floors ${band} released.`);
        await load();
        return null;
      },
      setBandMessage,
    );

  const savePrice = (): Promise<void> =>
    run(
      "price",
      async () => {
        if (!unit) return null;
        setMessage("");
        const result = await api("PUT", `/api/console/units/${unit.code}/price`, { json: { price: Number(price), expectedVersion: unit.priceVersion } });
        if (!result.ok) return failureText(result);
        notify(`Price saved for ${unit.code}.`);
        await Promise.all([load(), loadVersions(unit.code)]);
        return null;
      },
      setMessage,
    );

  const upload = (): Promise<void> =>
    run(
      "photo",
      async () => {
        if (!unit || !file) return null;
        setMessage("");
        const result = await api("PUT", `/api/console/units/${unit.code}/view-photo`, { raw: { body: file, type: file.type } });
        if (!result.ok) return failureText(result);
        notify(`Photo confirmed for ${unit.code}.`);
        setFile(null);
        if (fileInput.current) fileInput.current.value = "";
        await load();
        return null;
      },
      setMessage,
    );

  const withdraw = (): Promise<void> =>
    run(
      "withdraw",
      async () => {
        if (!unit) return null;
        setMessage("");
        const result = await api("POST", `/api/console/units/${unit.code}/withdraw`, { json: {} });
        setConfirmWithdraw(false);
        if (!result.ok) return failureText(result);
        notify(`${unit.code} withdrawn.`);
        await load();
        return null;
      },
      setMessage,
    );

  const convert = (hold: ConsoleHold): Promise<void> =>
    run(
      "convert",
      async () => {
        const result = await api("POST", `/api/console/holds/${hold.id}/convert`, { json: {} });
        if (!result.ok) return failureText(result);
        notify("Hold converted to a reservation.");
        await load();
        return null;
      },
      setBandMessage,
    );

  const editable = unit !== null && unit.status !== "withdrawn";

  return (
    <main className="console">
      <h1 className="sr-only">Sales console</h1>
      <section className="console-field field-ground" aria-label="Floor bands">
        <h2>Floor bands</h2>
        {unreleased.length === 0 ? <p>Every floor band is released.</p> : null}
        <div className="actions">
          {unreleased.map((band) => (
            <button key={band} type="button" className="button" disabled={busy !== null} onClick={() => void releaseBand(band)}>
              Release floors {band}
            </button>
          ))}
        </div>
        <p className="form-message" aria-live="polite">
          {busy === "release" || busy === "convert" ? BUSY_TEXT[busy] : bandMessage}
        </p>
      </section>

      <section className="console-field field-ink" aria-label="Unit editor">
        <h2>Unit editor</h2>
        <div className="field">
          <label htmlFor="console-unit">Unit code</label>
          <input id="console-unit" type="search" autoComplete="off" aria-describedby="console-unit-help" value={lookup} onChange={(event) => setLookup(event.target.value)} />
          <p id="console-unit-help" className="field-help">Type a unit code such as 31F to edit its price, photograph or status.</p>
        </div>
        {code !== "" && unit === null && units.length > 0 ? <p>No unit has the code {code}.</p> : null}
        {unit ? (
          <section className="unit-region" aria-label={`Unit ${unit.code}`}>
            <h3>Unit {unit.code}</h3>
            <p className="figures">
              {STATUS_LABEL[unit.status as CellStatus]} · {dollars(unit.price)} · price version {unit.priceVersion}
            </p>
            <p className="tag-line">{unit.viewPhotographed ? COPY.viewPhotographed : COPY.noViewPhotographed}</p>
            {unit.viewPhoto ? (
              <p className="figures small">
                {unit.viewPhoto.key} · {unit.viewPhoto.size} bytes · md5 {unit.viewPhoto.checksum}
              </p>
            ) : null}
            <div className="field">
              <label htmlFor="console-price">Price</label>
              <input
                id="console-price"
                role="spinbutton"
                inputMode="numeric"
                autoComplete="off"
                value={price}
                disabled={!editable}
                onChange={(event) => setPrice(event.target.value.replace(/\D/g, ""))}
              />
            </div>
            <div className="actions">
              <button type="button" className="button" disabled={!editable || busy !== null || price === ""} onClick={() => void savePrice()}>
                Save price
              </button>
            </div>
            {versions === null ? (
              <div className="skeleton-block" aria-hidden="true" />
            ) : (
              <table aria-label="Price versions" className="table">
                <thead>
                  <tr>
                    <th scope="col">Version</th>
                    <th scope="col">Price</th>
                    <th scope="col">Set by</th>
                    <th scope="col">Set at</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((version) => (
                    <tr key={version.version}>
                      <td className="figures">{version.version}</td>
                      <td className="figures">{dollars(version.price)}</td>
                      <td>{version.setBy}</td>
                      <td className="figures">{officeTime(version.setAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="field">
              <label htmlFor="console-photo">View photograph</label>
              <input
                id="console-photo"
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg"
                disabled={!editable}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </div>
            <div className="actions">
              <button type="button" className="button" disabled={!editable || file === null || busy !== null} onClick={() => void upload()}>
                Upload photo
              </button>
              <button ref={withdrawButton} type="button" className="button" disabled={!editable || unit.status === "unreleased" || busy !== null} onClick={() => setConfirmWithdraw(true)}>
                Withdraw unit
              </button>
            </div>
            <p className="form-message" aria-live="polite">
              {busy && busy !== "release" && busy !== "convert" ? BUSY_TEXT[busy] : message}
            </p>
          </section>
        ) : null}
      </section>

      <section className="console-field field-ground" aria-label="Holds">
        <h2>Active holds</h2>
        <table aria-label="Active holds" className="table">
          <thead>
            <tr>
              <th scope="col">Unit</th>
              <th scope="col">Buyer email</th>
              <th scope="col">Quoted price</th>
              <th scope="col">Ends</th>
              <th scope="col">
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {holds.map((hold) => (
              <tr key={hold.id}>
                <td className="figures">{hold.unitCode}</td>
                <td>{hold.buyerEmail}</td>
                <td className="figures">{dollars(hold.quotedPrice)}</td>
                <td className="figures">{officeTime(hold.endsAt)}</td>
                <td>
                  <button type="button" className="button" disabled={busy !== null} onClick={() => void convert(hold)}>
                    Convert {hold.unitCode}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {holds.length === 0 ? <p>No active holds.</p> : null}
      </section>

      {confirmWithdraw && unit ? (
        <Modal label={`Withdraw ${unit.code}?`} role="alertdialog" className="modal-confirm" scrim onClose={() => setConfirmWithdraw(false)} restoreFocus={() => withdrawButton.current}>
          <h2>Withdraw {unit.code}?</h2>
          <p>Any hold on it ends and it leaves search, the counts and the lens.</p>
          <div className="actions">
            <button type="button" className="button primary-solid" disabled={busy === "withdraw"} onClick={() => void withdraw()}>
              Withdraw
            </button>
            <button type="button" className="button" onClick={() => setConfirmWithdraw(false)}>
              Cancel
            </button>
          </div>
        </Modal>
      ) : null}
    </main>
  );
};
