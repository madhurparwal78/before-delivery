import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ApiFailure } from "../api.js";
import { ERRORS, STAFF_COPY } from "../../../shared/copy.js";
import { Button, TextField } from "../ui.js";
import { call, failureText, say } from "./desk.js";
import { formatPercent, formatRateStart, parsePercent } from "./format.js";
import { StaffList, type Column } from "./List.js";
import type { Rate } from "./types.js";

interface Problems {
  rate: string;
  effective: string;
}

const NONE: Problems = { rate: "", effective: "" };

const columns: Column<Rate>[] = [
  { header: "Rate", cell: (rate) => <strong>{formatPercent(rate.rateBasisPoints)}</strong> },
  { header: "In force from", cell: (rate) => formatRateStart(rate.effectiveFrom) },
];

export const RatesPage = () => {
  const [rates, setRates] = useState<Rate[]>([]);
  const [percent, setPercent] = useState("");
  const [effective, setEffective] = useState("");
  const [problems, setProblems] = useState<Problems>(NONE);

  const load = useCallback(async (): Promise<void> => {
    try {
      setRates((await call<{ rates: Rate[] }>("GET", "/api/staff/charity-rates")).body.rates);
    } catch (error) {
      say(failureText(error), true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refuse = (next: Problems, message: string): void => {
    setProblems(next);
    say(message, true);
  };

  const schedule = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setProblems(NONE);
    const basisPoints = parsePercent(percent);
    if (basisPoints === null) return refuse({ ...NONE, rate: ERRORS.rate_invalid.message() }, ERRORS.rate_invalid.message());
    const from = new Date(effective);
    if (Number.isNaN(from.getTime())) return refuse({ ...NONE, effective: ERRORS.validation_failed.message() }, ERRORS.validation_failed.message());
    try {
      await call("POST", "/api/staff/charity-rates", { json: { rateBasisPoints: basisPoints, effectiveFrom: from.toISOString() } });
      setPercent("");
      setEffective("");
      await load();
      say(STAFF_COPY.rateScheduled);
    } catch (error) {
      const message = failureText(error);
      const code = error instanceof ApiFailure ? error.code : null;
      refuse({ rate: code === "rate_invalid" ? message : "", effective: code === "rate_must_be_future" ? message : "" }, message);
    }
  };

  return (
    <>
      <form className="staff-form" aria-label="Schedule a rate" onSubmit={(event) => void schedule(event)}>
        <TextField label="New rate in percent" inputMode="decimal" autoComplete="off" value={percent} error={problems.rate} onChange={(event) => setPercent(event.target.value)} />
        <TextField
          label="Effective from"
          autoComplete="off"
          placeholder="2027-01-01T09:00"
          value={effective}
          error={problems.effective}
          onChange={(event) => setEffective(event.target.value)}
        />
        <Button variant="primary" type="submit">Schedule rate</Button>
      </form>
      <StaffList label="Rate history" rows={rates} rowKey={(rate) => rate.effectiveFrom} columns={columns} />
    </>
  );
};
