import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { rupees, promiseText } from "../../../shared/format";
import { Button } from "../../components/Button";
import { webglAvailable } from "../../effects/ripple";
import { ApiFailure, failureMessage, get } from "../../lib/api";
import { useReducedMotion } from "../../lib/hooks";
import { usePincode } from "../../lib/pincode";
import type { Offer } from "../../lib/types";

type CreateViewer = Awaited<ReturnType<typeof importViewer>>;

async function importViewer() {
  const { createViewer } = await import("../../effects/viewer3d");
  return createViewer;
}

let viewerModule: Promise<CreateViewer> | null = null;

/** three.js is a separate chunk: the page is usable first and the model arrives when the chunk has. */
export function loadViewer(): Promise<CreateViewer> {
  viewerModule ??= importViewer();
  return viewerModule;
}

interface ViewerProps {
  productId: string;
  category: string;
  title: string;
  imageUrl: string;
}

/** The 3D model, or the same framing as a still drawing when WebGL is not there. Either way it is `img "<title>, 3D view"`. */
export function ProductViewer({ productId, category, title, imageUrl }: ViewerProps): ReactNode {
  const reduced = useReducedMotion();
  const host = useRef<HTMLDivElement>(null);
  const [module, setModule] = useState<CreateViewer | null>(null);
  const [still, setStill] = useState(() => !webglAvailable());
  const label = `${title}, 3D view`;

  useEffect(() => {
    if (still) return undefined;
    let live = true;
    // `loaded` is a function: store it through an updater, or React would call it as one.
    void loadViewer().then((loaded) => live && setModule(() => loaded));
    return () => {
      live = false;
    };
  }, [still]);

  useLayoutEffect(() => {
    if (!module || !host.current) return undefined;
    const viewer = module(host.current, { productId, category, reduced });
    if (!viewer) {
      setStill(true);
      return undefined;
    }
    return () => viewer.dispose();
  }, [module, productId, category, reduced]);

  if (still) {
    return (
      <div className="viewer viewer--still" role="img" aria-label={label} data-cursor="drag">
        <img src={imageUrl} alt="" width={400} height={400} />
      </div>
    );
  }
  if (!module) return <div className="viewer skeleton" aria-busy="true" />;
  return <div className="viewer" ref={host} role="img" aria-label={label} data-cursor="drag" />;
}

interface DeliveryProps {
  offer: Offer | null;
  /** The pincode the page's promise is for. */
  pin: string | null;
}

/** The pincode field, and the promise and cash-on-delivery lines that follow the pincode in place. */
export function Delivery({ offer, pin }: DeliveryProps): ReactNode {
  const { info, check } = usePincode();
  const [text, setText] = useState(pin ?? "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!/^[1-9]\d{5}$/.test(text)) {
      setMessage("Enter a 6-digit pincode.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const found = await check(text);
      if (!found.serviceable) setMessage(`We don't deliver to ${text} yet.`);
    } catch (error) {
      setMessage(failureMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const covered = pin !== null && info?.pincode === pin && info.serviceable;
  let promise = "Enter your pincode to see the delivery date.";
  let cash = "";
  if (pin !== null && offer) {
    if (offer.promise_date) promise = `arrives by ${promiseText(offer.promise_date)}`;
    else promise = info?.pincode === pin && !info.serviceable ? `We don't deliver to ${pin} yet.` : `${offer.seller_name} doesn't deliver to ${pin}.`;
    if (offer.cod_available) cash = "Cash on delivery available.";
    else if (info?.pincode === pin && !info.cod_available) cash = `Cash on delivery isn't available at ${pin}.`;
    else cash = `${offer.seller_name} doesn't offer cash on delivery.`;
  }

  return (
    <section className="product__delivery card card--black" aria-label="Delivery">
      <form onSubmit={(event) => void submit(event)} noValidate className="product__pin">
        <div className="field">
          <label htmlFor="product-pincode">Pincode</label>
          <input id="product-pincode" inputMode="numeric" autoComplete="postal-code" maxLength={6} value={text} onChange={(event) => setText(event.target.value.trim())} />
        </div>
        <Button type="submit" busy={busy}>
          Check pincode
        </Button>
      </form>
      <div aria-live="polite">
        {message !== "" && <p className="field-error">{message}</p>}
        {covered && info && <p className="muted">{`Delivers to ${info.city ?? pin}${info.state ? `, ${info.state}` : ""}.`}</p>}
        <p className="product__promise">{promise}</p>
        {cash !== "" && <p className="muted">{cash}</p>}
      </div>
    </section>
  );
}

interface Plan {
  tenure_months: number;
  no_cost: boolean;
  upfront_discount_paise: number;
  instalment_paise: number;
  total_interest_paise: number;
  total_payable_paise: number;
}

/** `table "EMI plans"` for the featured listing; a clear note instead when the amount is under the EMI minimum. */
export function EmiPlans({ listingId }: { listingId: string | null }): ReactNode {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    setPlans(null);
    setNote("");
    if (!listingId) return undefined;
    let live = true;
    get<{ plans: Plan[] }>(`/api/emi-plans?listing_id=${encodeURIComponent(listingId)}`).then(
      (found) => live && setPlans(found.plans),
      (error: unknown) => {
        if (!live) return;
        if (error instanceof ApiFailure && error.body.errors?.amount) setNote(error.body.errors.amount);
        else setNote(failureMessage(error));
      },
    );
    return () => {
      live = false;
    };
  }, [listingId]);

  if (note !== "") return <p className="shout shout--small">{note}</p>;
  if (!plans) return <div className="skeleton" aria-busy="true" />;
  return (
    <div className="table-scroll">
      <table className="emi" aria-label="EMI plans">
        <thead>
          <tr>
            <th scope="col">Tenure</th>
            <th scope="col">Monthly instalment</th>
            <th scope="col">Total interest</th>
            <th scope="col">Total payable</th>
          </tr>
        </thead>
        <tbody>
          {plans.map((plan) => (
            <tr key={plan.tenure_months}>
              <th scope="row">
                {plan.tenure_months} months
                {plan.no_cost && <span className="chip chip--accent">no-cost</span>}
              </th>
              <td className="amount">{rupees(plan.instalment_paise)}</td>
              <td className="amount">{rupees(plan.total_interest_paise)}</td>
              <td className="amount">{rupees(plan.total_payable_paise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
