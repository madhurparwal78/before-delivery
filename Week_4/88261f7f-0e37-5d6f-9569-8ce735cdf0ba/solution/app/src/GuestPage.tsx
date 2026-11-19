import { useEffect, useState, type FormEvent } from "react";
import type { GuestPage as GuestPageData } from "../shared/api";
import { call, get, refusalText } from "./api";
import { useBusy } from "./hooks";
import { EmptySheet, FieldMessage } from "./ui";

const DEAD = "This check-in link is no longer valid.";

export function GuestPage({ token }: { token: string }) {
  const [page, setPage] = useState<GuestPageData | "dead" | null>(null);
  const [status, setStatus] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [nameError, setNameError] = useState("");
  const [uploading, guardUpload] = useBusy();
  const [completing, guardComplete] = useBusy();

  useEffect(() => {
    void get<GuestPageData>(`/api/checkin/${encodeURIComponent(token)}`).then((answer) => {
      setPage(answer.ok ? answer.data : "dead");
      if (answer.ok && answer.data.photo === "received") setStatus("Received");
    });
  }, [token]);

  if (page === null) return <main className="page guest" aria-busy="true" />;
  if (page === "dead") {
    return (
      <main className="page guest">
        <h1>Check in</h1>
        <p>{DEAD}</p>
        <EmptySheet>Ask the front desk for a new link.</EmptySheet>
      </main>
    );
  }

  const upload = (event: FormEvent): void => {
    event.preventDefault();
    void guardUpload(async () => {
      setStatus("Uploading photo…");
      const form = new FormData();
      if (file) form.append("photo", file);
      const answer = await fetch(`/api/checkin/${encodeURIComponent(token)}/photo`, { method: "POST", body: form })
        .then(async (reply) => ({ ok: reply.ok, body: (await reply.json().catch(() => ({}))) as { error?: string } }))
        .catch(() => ({ ok: false, body: { error: "Your photo could not be saved. Please try again." } }));
      setStatus(answer.ok ? "Received" : (answer.body.error ?? "Your photo could not be saved. Please try again."));
    });
  };

  const complete = (event: FormEvent): void => {
    event.preventDefault();
    void guardComplete(async () => {
      setNameError("");
      setStatus("Completing check-in…");
      const answer = await call<{ completed: boolean }>("POST", `/api/checkin/${encodeURIComponent(token)}/complete`, { fullName, phone });
      if (answer.ok) setStatus(`Check-in complete. See you on ${page.arrival}.`);
      else {
        setNameError(answer.errors.fullName ?? "");
        setStatus(answer.status === 404 ? DEAD : refusalText(answer));
      }
    });
  };

  return (
    <main className="page guest">
      <h1>Check in</h1>
      <p className="hotel-name">{page.hotelName}</p>
      <p>
        {page.arrival} to {page.departure} · {page.roomType}
      </p>
      <p className="muted">Upload a photo of your ID, then complete the form below.</p>
      <div role="status" aria-label="Check-in status" className="notice">{status}</div>
      <form onSubmit={upload} className="sheet">
        <label>
          ID photo
          <input type="file" accept="image/jpeg,image/png" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </label>
        <button type="submit" aria-busy={uploading}>Upload photo</button>
      </form>
      <form onSubmit={complete} className="sheet">
        <label>
          Full name
          <input type="text" value={fullName} autoComplete="name" onChange={(event) => setFullName(event.target.value)} />
        </label>
        <FieldMessage message={nameError} />
        <label>
          Phone
          <input type="tel" value={phone} autoComplete="tel" onChange={(event) => setPhone(event.target.value)} />
        </label>
        <button type="submit" className="primary" aria-busy={completing}>Complete check-in</button>
      </form>
    </main>
  );
}
