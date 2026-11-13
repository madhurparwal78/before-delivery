import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "../../components/Button";
import { Empty } from "../../components/Empty";
import { failureMessage, get, post } from "../../lib/api";
import { useTitle } from "../../lib/hooks";
import { PromiseDate, SellerLines, ShipTo, StatusChips, type SellerShipment } from "./shipmentParts";
import { Failure, Loading, StaffGate } from "./staff";

interface ShipmentsReply {
  shipments: SellerShipment[];
  next_cursor: string | null;
}

type Move = "pack" | "ship" | "deliver";

const LABEL_POLL_MS = 3000;

function Card({ shipment, pink, onChange }: { shipment: SellerShipment; pink: boolean; onChange: (next: SellerShipment) => void }): ReactNode {
  const [busy, setBusy] = useState<Move | null>(null);
  const [problem, setProblem] = useState("");
  const id = shipment.shipment_id;
  const waitingForLabel = shipment.state === "packed" && shipment.label_status === "pending";

  useEffect(() => {
    if (!waitingForLabel) return undefined;
    const timer = window.setTimeout(() => {
      get<SellerShipment>(`/api/shipments/${id}`).then(onChange, () => undefined);
    }, LABEL_POLL_MS);
    return () => window.clearTimeout(timer);
  }, [waitingForLabel, id, onChange, shipment]);

  const move = async (action: Move): Promise<void> => {
    setBusy(action);
    setProblem("");
    try {
      onChange(await post<SellerShipment>(`/api/seller/shipments/${id}/${action}`, {}));
    } catch (error) {
      setProblem(failureMessage(error));
    }
    setBusy(null);
  };

  return (
    <section className={`card shipment-card${pink ? " card--pink" : ""}`} aria-label={`Shipment ${id}`}>
      <h2 className="shipment-card__id" tabIndex={-1} id={`heading-${id}`}>
        {id}
      </h2>
      <StatusChips shipment={shipment} />
      <PromiseDate shipment={shipment} />
      <ShipTo shipment={shipment} />
      <SellerLines shipment={shipment} />
      {waitingForLabel && <p className="staff-note">Label is being prepared. Packing can continue.</p>}
      {problem && (
        <p className="field-error" role="alert">
          {problem}
        </p>
      )}
      <div className="shipment-card__actions">
        {shipment.state === "placed" && (
          <Button variant={pink ? "dark" : "primary"} busy={busy === "pack"} onClick={() => void move("pack")}>
            Mark packed
          </Button>
        )}
        {shipment.state === "packed" && (
          <Button variant={pink ? "dark" : "primary"} busy={busy === "ship"} disabled={shipment.label_status === "pending"} onClick={() => void move("ship")}>
            Mark shipped
          </Button>
        )}
        {shipment.state === "shipped" && (
          <Button variant={pink ? "dark" : "primary"} busy={busy === "deliver"} onClick={() => void move("deliver")}>
            Mark delivered
          </Button>
        )}
        {shipment.label_status === "ready" && (
          <a className="btn btn--dark btn--small" href={`/api/seller/shipments/${id}/label`} target="_blank" rel="noreferrer">
            Print label
          </a>
        )}
        {shipment.invoice_status === "ready" ? (
          <a className="btn btn--dark btn--small" href={`/api/shipments/${id}/invoice`} target="_blank" rel="noreferrer">
            Invoice
          </a>
        ) : (
          <a className="btn btn--dark btn--small" aria-disabled="true" role="link">
            Invoice
          </a>
        )}
      </div>
    </section>
  );
}

function ShipmentsPage(): ReactNode {
  useTitle("shipments");
  const [shipments, setShipments] = useState<SellerShipment[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [failed, setFailed] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState("");
  const focusAfter = useRef<string | null>(null);

  useEffect(() => {
    get<ShipmentsReply>("/api/seller/shipments?limit=24").then(
      (reply) => {
        setShipments(reply.shipments);
        setNext(reply.next_cursor);
      },
      (error: unknown) => setFailed(failureMessage(error)),
    );
  }, []);

  useEffect(() => {
    if (focusAfter.current === null) return;
    document.getElementById(`heading-${focusAfter.current}`)?.focus();
    focusAfter.current = null;
  });

  const loadMore = async (cursor: string): Promise<void> => {
    setLoadingMore(true);
    setMoreFailed("");
    try {
      const reply = await get<ShipmentsReply>(`/api/seller/shipments?limit=24&cursor=${encodeURIComponent(cursor)}`);
      focusAfter.current = reply.shipments[0]?.shipment_id ?? null;
      setShipments((current) => [...(current ?? []), ...reply.shipments]);
      setNext(reply.next_cursor);
    } catch (error) {
      setMoreFailed(failureMessage(error));
    }
    setLoadingMore(false);
  };

  if (failed) return <Failure status={0} message={failed} />;

  return (
    <>
      <section className="panel panel--ground staff-head">
        <h1>shipments</h1>
      </section>
      {shipments === null && <Loading />}
      {shipments?.length === 0 && (
        <Empty tone="black" sign="box">
          no shipments yet.
        </Empty>
      )}
      {shipments && shipments.length > 0 && (
        <section className="panel panel--black staff-results">
          <div className="card-grid">
            {shipments.map((shipment, index) => (
              <Card
                key={shipment.shipment_id}
                shipment={shipment}
                pink={index % 2 === 1}
                onChange={(changed) => setShipments((current) => current?.map((row) => (row.shipment_id === changed.shipment_id ? changed : row)) ?? null)}
              />
            ))}
          </div>
          {moreFailed && (
            <p className="field-error" role="alert">
              {moreFailed}
            </p>
          )}
          {next && (
            <div className="staff-more">
              <Button variant="primary" busy={loadingMore} onClick={() => void loadMore(next)}>
                Load more
              </Button>
            </div>
          )}
        </section>
      )}
    </>
  );
}

export default function Shipments(): ReactNode {
  return (
    <StaffGate role="seller">
      <ShipmentsPage />
    </StaffGate>
  );
}
