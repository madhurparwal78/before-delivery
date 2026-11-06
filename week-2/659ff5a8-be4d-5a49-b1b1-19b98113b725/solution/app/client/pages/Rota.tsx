import { type FormEvent, useEffect, useState } from "react";
import type { RegistrationView, RotaHeat, RotaStation } from "../../shared/api.js";
import { ApiFailure, api } from "../api.js";
import { Dialog } from "../components/Dialog.js";
import { useEvent } from "../components/EventFrame.js";
import { Skeleton, StatusRegion } from "../components/ui.js";
import { stationsOpen } from "../format.js";
import { useRefresh } from "../hooks.js";
import { isStaff, useUser } from "../session.js";

interface Seat {
  station: RotaStation;
  heat: number;
}

export function Rota() {
  const { event, rota, reloadRota } = useEvent();
  const user = useUser();
  const [registrations, setRegistrations] = useState<RegistrationView[]>([]);
  const [message, setMessage] = useState("");
  const [assigning, setAssigning] = useState<Seat | null>(null);
  const [busy, setBusy] = useState(false);
  const reloadRegistrations = useRefresh(
    async () => setRegistrations((await api.get<{ registrations: RegistrationView[] }>(`/api/events/${event.id}/registrations`)).registrations),
    3,
    [event.id],
  );
  const mine = registrations.find((r) => r.driver.id === user.id) ?? null;
  const worker = isStaff(user, "workers");

  useEffect(() => {
    const anchor = window.location.hash.slice(1);
    if (anchor && rota) document.getElementById(anchor)?.scrollIntoView();
  }, [rota === null]);

  const act = async (pending: string, work: () => Promise<string>): Promise<void> => {
    setBusy(true);
    setMessage(pending);
    try {
      setMessage(await work());
    } catch (error) {
      setMessage(rotaFailure(error, mine?.runHeat));
    } finally {
      setBusy(false);
      reloadRota();
      reloadRegistrations();
    }
  };

  const claim = (seat: Seat): Promise<void> =>
    act("Claiming", async () => {
      const { assignmentEmail } = await api.post<{ assignmentEmail: "sent" | "pending" }>(`/api/stations/${seat.station.id}/claim`);
      return (
        `You are working ${seat.station.name} in heat ${seat.heat}.` +
        (assignmentEmail === "pending" ? " Your assignment email is delayed. We'll keep trying." : "")
      );
    });

  const release = (seat: Seat): Promise<void> =>
    act("Releasing", async () => {
      await api.delete(`/api/stations/${seat.station.id}/claim`);
      return `${seat.station.name} in heat ${seat.heat} is open again.`;
    });

  return (
    <>
      <div className="page-head">
        <h1>Rota</h1>
      </div>
      <StatusRegion name="Rota updates" reserve>{message}</StatusRegion>
      {rota === null ? (
        <Skeleton />
      ) : (
        rota.map((heat) => (
          <HeatSection
            key={heat.number}
            heat={heat}
            canClaim={mine !== null}
            canAssign={worker}
            canRelease={(station) => worker || station.worker?.registrationId === mine?.id}
            busy={busy}
            onClaim={(station) => void claim({ station, heat: heat.number })}
            onRelease={(station) => void release({ station, heat: heat.number })}
            onAssign={(station) => setAssigning({ station, heat: heat.number })}
          />
        ))
      )}
      {assigning ? (
        <AssignWorker
          seat={assigning}
          registrations={registrations}
          rota={rota ?? []}
          onClose={() => setAssigning(null)}
          onAssigned={(text) => {
            setMessage(text);
            setAssigning(null);
            reloadRota();
            reloadRegistrations();
          }}
          onFailed={(error) => {
            setMessage(rotaFailure(error, undefined));
            setAssigning(null);
            reloadRota();
          }}
          onPending={() => setMessage("Assigning")}
        />
      ) : null}
    </>
  );
}

function rotaFailure(error: unknown, runHeat: number | undefined): string {
  if (!(error instanceof ApiFailure)) return "Could not update the rota. Try again.";
  if (error.code === "station_taken") return "That station was just taken. Pick another.";
  if (error.code === "own_heat") return `You drive in heat ${runHeat ?? "that"}. Pick a station in another heat.`;
  if (error.code === "already_assigned") return "You already have a work station for this event.";
  return error.message;
}

interface HeatProps {
  heat: RotaHeat;
  canClaim: boolean;
  canAssign: boolean;
  canRelease: (station: RotaStation) => boolean;
  busy: boolean;
  onClaim: (station: RotaStation) => void;
  onRelease: (station: RotaStation) => void;
  onAssign: (station: RotaStation) => void;
}

function HeatSection({ heat, canClaim, canAssign, canRelease, busy, onClaim, onRelease, onAssign }: HeatProps) {
  return (
    <section id={`heat-${heat.number}`} className="panel" aria-labelledby={`heat-title-${heat.number}`}>
      <h2 id={`heat-title-${heat.number}`}>
        Heat {heat.number}: {stationsOpen(heat.unfilled)}
      </h2>
      <ul className="station-list">
        {heat.stations.map((station) => (
          <li key={station.id} className="station">
            <span className="station-name">{station.name}</span>
            <span className="station-worker">
              {station.worker ? `${station.worker.driverName}, car ${station.worker.carNumber} ${station.worker.classCode}` : "Open"}
            </span>
            <span className="station-actions">
              {station.worker === null && canClaim ? (
                <button type="button" className="btn btn-secondary" aria-label={`Claim ${station.name}, heat ${heat.number}`} disabled={busy} onClick={() => onClaim(station)}>
                  Claim
                </button>
              ) : null}
              {station.worker === null && canAssign ? (
                <button type="button" className="btn btn-secondary" aria-label={`Assign ${station.name}, heat ${heat.number}`} disabled={busy} onClick={() => onAssign(station)}>
                  Assign
                </button>
              ) : null}
              {station.worker !== null && canRelease(station) ? (
                <button type="button" className="btn btn-secondary" aria-label={`Release ${station.name}, heat ${heat.number}`} disabled={busy} onClick={() => onRelease(station)}>
                  Release
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface AssignProps {
  seat: Seat;
  registrations: RegistrationView[];
  rota: RotaHeat[];
  onClose: () => void;
  onAssigned: (text: string) => void;
  onFailed: (error: unknown) => void;
  onPending: () => void;
}

function AssignWorker({ seat, registrations, rota, onClose, onAssigned, onFailed, onPending }: AssignProps) {
  const holding = new Set(rota.flatMap((h) => h.stations).flatMap((s) => (s.worker ? [s.worker.registrationId] : [])));
  const eligible = registrations
    .filter((r) => !holding.has(r.id) && r.runHeat !== seat.heat)
    .sort((a, b) => a.driver.name.localeCompare(b.driver.name, "en"));
  const [chosen, setChosen] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const selected = chosen ?? eligible[0]?.id ?? null;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const driver = eligible.find((r) => r.id === selected);
    if (!driver) return;
    setPending(true);
    onPending();
    try {
      await api.post(`/api/stations/${seat.station.id}/assign`, { registrationId: driver.id });
      onAssigned(`${driver.driver.name} is working ${seat.station.name} in heat ${seat.heat}.`);
    } catch (error) {
      onFailed(error);
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog title="Assign worker" onClose={onClose}>
      <form aria-label="Assign worker form" onSubmit={(e) => void submit(e)}>
        <p className="muted">
          {seat.station.name}, heat {seat.heat}
        </p>
        <div className="field">
          <label htmlFor="assign-driver">Driver</label>
          <select id="assign-driver" value={selected ?? ""} onChange={(e) => setChosen(Number(e.target.value))}>
            {eligible.map((r) => (
              <option key={r.id} value={r.id}>
                {r.driver.name}, car {r.carNumber} {r.classCode}
              </option>
            ))}
          </select>
        </div>
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" disabled={pending || selected === null} aria-busy={pending}>
            Assign
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}
