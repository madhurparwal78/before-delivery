import React, { useEffect, useState } from "react";
import { api, ApiError, cents, type Kiln, type KilnProfile, type RateSet, type User } from "../api.js";
import { useSession } from "../shared.js";

interface Segment {
  rate_f_per_hour: string;
  target_f: string;
  hold_minutes: string;
}

function defaultSegments(profile: KilnProfile): Segment[] {
  return profile.segments.map((s) => ({
    rate_f_per_hour: String(s.rate_f_per_hour),
    target_f: String(s.target_f),
    hold_minutes: String(s.hold_minutes)
  }));
}

export default function Rates(): React.ReactElement {
  const [rateSets, setRateSets] = useState<RateSet[]>([]);
  const [bisque, setBisque] = useState("0.0300");
  const [glaze, setGlaze] = useState("0.0400");
  const [discount, setDiscount] = useState("10");
  const [minimum, setMinimum] = useState("3.00");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [ratesResult, setRatesResult] = useState<string | null>(null);
  const [kilns, setKilns] = useState<Kiln[]>([]);
  const [editProfile, setEditProfile] = useState<{ kiln: Kiln; profile: KilnProfile } | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [coolDown, setCoolDown] = useState("12");
  const [profileResult, setProfileResult] = useState<string | null>(null);

  const load = () => {
    api.get<RateSet[]>("/api/rates").then(setRateSets).catch(() => undefined);
    api.get<Kiln[]>("/api/kilns").then(setKilns).catch(() => undefined);
  };

  useEffect(load, []);

  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const saveRates = async () => {
    setRatesResult("Saving rates…");
    const minimumCents = Math.round(Number(minimum) * 100);
    try {
      await api.post<RateSet>("/api/rates", {
        bisque_rate: bisque,
        glaze_rate: glaze,
        member_discount_percent: Number(discount),
        order_minimum_cents: minimumCents,
        effective_date: effectiveDate || dateStr
      });
      setRatesResult(`Rates saved. They apply to pieces accepted from ${effectiveDate || dateStr}.`);
      load();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 422 && err.fields) {
          setRatesResult(Object.values(err.fields)[0] ?? "Check these fields");
        } else if (err.code === "rate_date_taken") {
          setRatesResult(`Rates already set for ${effectiveDate || dateStr}.`);
        } else {
          setRatesResult(err.message);
        }
      } else {
        setRatesResult("Something went wrong.");
      }
    }
  };

  const saveProfileReal = async () => {
    if (!editProfile) return;
    setProfileResult("Saving profile…");
    try {
      const res = await fetch(`/api/kilns/${editProfile.kiln.id}/profiles/${editProfile.profile.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          segments: segments.map((s) => ({
            rate_f_per_hour: Number(s.rate_f_per_hour),
            target_f: Number(s.target_f),
            hold_minutes: Number(s.hold_minutes)
          })),
          cool_down_hours: Number(coolDown)
        })
      });
      if (!res.ok) {
        const body = (await res.json()) as { error: string; message: string; fields?: Record<string, string> };
        if (body.fields) {
          setProfileResult(Object.values(body.fields)[0] ?? "Check these fields");
        } else {
          setProfileResult(body.message);
        }
        return;
      }
      setProfileResult("Profile saved. It applies to firings started from now on.");
      setEditProfile(null);
      load();
    } catch {
      setProfileResult("Something went wrong.");
    }
  };

  return (
    <main>
      <h1>Rates</h1>
      <div className="studio-grid">
        <form
          className="pane"
          aria-label="Firing rates"
          onSubmit={(e) => {
            e.preventDefault();
            void saveRates();
          }}
        >
          <h2>Firing rates</h2>
          <div className="field">
            <label htmlFor="bisque-rate">Bisque rate ($ per in³)</label>
            <input id="bisque-rate" value={bisque} onChange={(e) => setBisque(e.target.value)} inputMode="decimal" />
          </div>
          <div className="field">
            <label htmlFor="glaze-rate">Glaze rate ($ per in³)</label>
            <input id="glaze-rate" value={glaze} onChange={(e) => setGlaze(e.target.value)} inputMode="decimal" />
          </div>
          <div className="field">
            <label htmlFor="member-discount">Member discount (%)</label>
            <input
              id="member-discount"
              type="number"
              min="0"
              max="50"
              step="1"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="order-minimum">Order minimum ($)</label>
            <input id="order-minimum" value={minimum} onChange={(e) => setMinimum(e.target.value)} inputMode="decimal" />
          </div>
          <div className="field">
            <label htmlFor="effective-date">Effective date</label>
            <input
              id="effective-date"
              type="date"
              value={effectiveDate || dateStr}
              min={dateStr}
              onChange={(e) => setEffectiveDate(e.target.value)}
            />
          </div>
          <button type="submit" className="primary">
            Save rates
          </button>
          <div role="status" aria-live="polite" className="status-line" aria-label="Rates result">
            {ratesResult ? <span>{ratesResult}</span> : <span className="sr-only">Rates result</span>}
          </div>
        </form>

        <div className="pane">
          <h2>Rate history</h2>
          <table aria-label="Rate history">
            <thead>
              <tr>
                <th>Effective</th>
                <th>Bisque</th>
                <th>Glaze</th>
                <th>Discount</th>
                <th>Minimum</th>
              </tr>
            </thead>
            <tbody>
              {rateSets.map((r) => (
                <tr key={r.id} className="hairline-row">
                  <td className="num">{r.effective_date}</td>
                  <td className="num">${r.bisque_rate}/in³</td>
                  <td className="num">${r.glaze_rate}/in³</td>
                  <td className="num">{r.member_discount_percent}%</td>
                  <td className="num">{cents(r.order_minimum_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="pane" role="region" aria-label="Kiln profiles">
        <h2>Kiln profiles</h2>
        {kilns.map((k) =>
          k.profiles.map((p) => (
            <div key={`${k.id}-${p.id}`} className="hairline-row" style={{ padding: "0.6rem 0", display: "flex", flexWrap: "wrap", gap: "0.6rem", alignItems: "center" }}>
              <span>
                {p.name} on {k.name}
              </span>
              <span className="num small-note">
                {p.stage} · Cone {p.cone} · {p.firing_hours} h · cool {p.cool_down_hours} h
              </span>
              <button
                onClick={() => {
                  setEditProfile({ kiln: k, profile: p });
                  setSegments(defaultSegments(p));
                  setCoolDown(String(p.cool_down_hours));
                  setProfileResult(null);
                }}
              >
                Edit {p.name} on {k.name}
              </button>
            </div>
          ))
        )}
        <div role="status" aria-live="polite" className="status-line" aria-label="Profile result">
          {profileResult ? <span>{profileResult}</span> : <span className="sr-only">Profile result</span>}
        </div>
      </div>

      {editProfile ? (
        <div className="dialog-backdrop" role="presentation">
          <div className="dialog" role="dialog" aria-modal="true" aria-label="Edit profile">
            <h2>Edit profile</h2>
            <p>
              {editProfile.profile.name} on {editProfile.kiln.name}
            </p>
            <table>
              <thead>
                <tr>
                  <th>Segment</th>
                  <th>Rate (°F per hour)</th>
                  <th>Target (°F)</th>
                  <th>Hold (minutes)</th>
                </tr>
              </thead>
              <tbody>
                {segments.map((s, i) => (
                  <tr key={i}>
                    <td className="num">{i + 1}</td>
                    <td>
                      <input
                        type="number"
                        aria-label={`Segment ${i + 1} rate (°F per hour)`}
                        value={s.rate_f_per_hour}
                        onChange={(e) =>
                          setSegments((arr) => arr.map((x, j) => (j === i ? { ...x, rate_f_per_hour: e.target.value } : x)))
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        aria-label={`Segment ${i + 1} target (°F)`}
                        value={s.target_f}
                        onChange={(e) =>
                          setSegments((arr) => arr.map((x, j) => (j === i ? { ...x, target_f: e.target.value } : x)))
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        aria-label={`Segment ${i + 1} hold (minutes)`}
                        value={s.hold_minutes}
                        onChange={(e) =>
                          setSegments((arr) => arr.map((x, j) => (j === i ? { ...x, hold_minutes: e.target.value } : x)))
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="field-row" style={{ marginTop: "0.8rem" }}>
              <button
                onClick={() =>
                  setSegments((arr) => [...arr, { rate_f_per_hour: "180", target_f: "1000", hold_minutes: "0" }])
                }
              >
                Add segment
              </button>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="cool-down">Cool-down (hours)</label>
                <input id="cool-down" type="number" min="1" max="72" value={coolDown} onChange={(e) => setCoolDown(e.target.value)} />
              </div>
            </div>
            <div className="field-row" style={{ marginTop: "0.8rem" }}>
              <button className="primary" onClick={() => void saveProfileReal()}>
                Save profile
              </button>
              <button onClick={() => setEditProfile(null)}>Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
