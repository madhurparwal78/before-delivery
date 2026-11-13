import { useCallback, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "../../components/Button";
import { Tiffin, openness } from "../../effects/tiffin";
import { failureMessage } from "../../lib/api";
import { useReducedMotion } from "../../lib/hooks";
import { usePincode, type PincodeInfo } from "../../lib/pincode";
import { promiseText } from "../../../shared/format";
import { Marquee } from "./Marquee";
import { ParticleWordmark } from "./ParticleWordmark";
import { useScrollSync } from "./scrollSync";
import type { DealsState } from "./useDeals";

type Result = { info: PincodeInfo } | { error: string };

function sentence(result: Result, deals: DealsState): string {
  if ("error" in result) return result.error;
  const { info } = result;
  if (!info.serviceable) return `We don't deliver to ${info.pincode} yet.`;
  const dates = deals.forPin === info.pincode ? (deals.deals ?? []).flatMap((deal) => (deal.promise_date ? [deal.promise_date] : [])).sort() : [];
  return [`We deliver to ${info.city ?? info.pincode}.`, dates[0] && `Arrives by ${promiseText(dates[0])}.`, info.cod_available && "Cash on delivery available."]
    .filter((part) => typeof part === "string" && part !== "")
    .join(" ");
}

/** The ultramarine field over the black band: headline, particle wordmark, the straddling tiffin, the pincode check and the promises marquee. */
export function Hero({ deals }: { deals: DealsState }): ReactNode {
  const pincode = usePincode();
  const stage = useRef<HTMLElement>(null);
  const [value, setValue] = useState(pincode.pin ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const reduced = useReducedMotion();
  /** The tiers open in step with scrollY over the first 900 px; reduced motion keeps the closed stack. */
  const scrub = useCallback((): void => stage.current?.style.setProperty("--open", String(reduced ? 0 : openness(window.scrollY))), [reduced]);
  useScrollSync(true, scrub);

  const check = (event: FormEvent): void => {
    event.preventDefault();
    setBusy(true);
    pincode
      .check(value.trim())
      .then(
        (info) => setResult({ info }),
        (error: unknown) => setResult({ error: failureMessage(error) }),
      )
      .finally(() => setBusy(false));
  };

  return (
    <section className="hero" ref={stage}>
      <div className="hero__field">
        <h1 className="hero__title">
          <span>everything.</span> <span>one cart.</span>
        </h1>
        <ParticleWordmark />
      </div>
      <div className="hero__band">
        <Marquee />
        <Tiffin className="hero__tiffin" />
        <form className="hero__form" onSubmit={check} noValidate>
          <div className="field">
            <label htmlFor="home-pincode">Your pincode</label>
            <input id="home-pincode" inputMode="numeric" autoComplete="postal-code" maxLength={6} value={value} onChange={(event) => setValue(event.target.value)} />
          </div>
          <Button type="submit" variant="yellow" busy={busy} className="hero__check">
            Check
          </Button>
        </form>
        <p role="status" aria-label="Pincode result" className="hero__result">
          {result ? sentence(result, deals) : ""}
        </p>
      </div>
    </section>
  );
}
