// The vet's read-only comparison page at /vet/<token>: no sign-in, no rail, nothing that changes anything
// (brief: Screens and layout, Vet page; Feedback states, Vet page).
import { useEffect, useState } from "react";
import { type Hoof, type VetView, get } from "./api";
import { HOOVES } from "./format";
import { ComparisonStage, HoofPicker, Readout } from "./stage";
import { NETWORK_COPY, NotAvailable, Skeleton } from "./ui";

type Load = { kind: "loading" } | { kind: "ready"; view: VetView } | { kind: "failed"; copy: string };

export function VetPage({ token }: { token: string }) {
  const [state, setState] = useState<Load>({ kind: "loading" });
  const [hoof, setHoof] = useState<Hoof>("LF");
  const [glideToken, setGlideToken] = useState(0);

  useEffect(() => {
    let live = true;
    void get<VetView>(`/api/vet/${encodeURIComponent(token)}`).then((result) => {
      if (!live) return;
      if (result.ok) {
        setState({ kind: "ready", view: result.data });
        setHoof(HOOVES.find((code) => result.data.hooves[code]) ?? "LF");
      } else if (result.status === 429)
        setState({ kind: "failed", copy: `Too many attempts. Try again in ${result.retryAfter ?? 1} seconds.` });
      else if (result.status === 404) setState({ kind: "failed", copy: "This comparison link is no longer available." });
      else setState({ kind: "failed", copy: NETWORK_COPY });
    });
    return () => {
      live = false;
    };
  }, [token]);

  return (
    <div className="vet-page">
      <header className="vet-header">
        <span className="wordmark-text">
          Rasp &amp; Rein <span className="wordmark-product">Clinchline</span>
        </span>
        <span className="muted">Read-only hoof comparison</span>
      </header>
      <main className="vet-main">
        {state.kind === "loading" ? (
          <Skeleton rows={4} />
        ) : state.kind === "failed" ? (
          <NotAvailable copy={state.copy} />
        ) : (
          <>
            <h1 className="page-title">{state.view.horse.name}</h1>
            <p className="vet-dates num">
              <span>Previous visit {state.view.previous_date}</span>
              <span>Current visit {state.view.current_date}</span>
            </p>
            <ComparisonStage comparison={state.view.hooves[hoof]} hoof={hoof} glideToken={glideToken} loading={false} />
            <div className="stage-under">
              <HoofPicker
                hoof={hoof}
                name="vet-hoof"
                onPick={(next) => {
                  setHoof(next);
                  setGlideToken((value) => value + 1);
                }}
              />
              <Readout comparison={state.view.hooves[hoof]} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
