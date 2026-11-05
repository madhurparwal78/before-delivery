import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { api, pieceNumber } from "../api.js";
import { StatusChip } from "../shared.js";

interface TrackingData {
  piece_number: number;
  status: string;
  status_label: string;
  pickup_shelf: string | null;
}

export default function Tracking(): React.ReactElement {
  const location = useLocation();
  const token = decodeURIComponent(location.pathname.split("/")[2] ?? "");
  const [state, setState] = useState<"loading" | "active" | "dead">("loading");
  const [data, setData] = useState<TrackingData | null>(null);

  useEffect(() => {
    api
      .get<TrackingData>(`/api/track/${token}`)
      .then((d) => {
        setData(d);
        setState("active");
      })
      .catch(() => setState("dead"));
  }, [token]);

  return (
    <div className="track-page">
      <div className="track-ticket">
        {state === "loading" ? <p role="status">Loading…</p> : null}
        {state === "dead" ? <p>This tracking link is no longer active.</p> : null}
        {state === "active" && data ? (
          <>
            <h1>
              Piece <span className="num">{pieceNumber(data.piece_number)}</span>
            </h1>
            <p style={{ fontSize: "1.1rem" }}>
              <StatusChip status={data.status} label={data.status_label} />
            </p>
            {data.pickup_shelf ? (
              <p className="num" style={{ marginTop: "0.8rem" }}>
                Pickup shelf {data.pickup_shelf}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
