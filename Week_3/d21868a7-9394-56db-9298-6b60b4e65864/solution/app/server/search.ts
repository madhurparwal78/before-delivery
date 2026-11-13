// Live search suggestions within the caller's reach (brief: Search reach).
import type { User } from "./auth.ts";
import type { Db } from "./db.ts";
import { formatMl } from "./decimal.ts";
import { FieldErrors } from "./http.ts";
import { loadWindows, type WindowFigures } from "./records.ts";

type Kind = "channel" | "turnout" | "grower" | "operator";
interface Suggestion {
  kind: Kind;
  label: string;
  detail: string;
  href: string;
}

const KIND_ORDER: Kind[] = ["channel", "turnout", "grower", "operator"];
const LIMIT = 8;

export async function search(db: Db, user: User, q: string | null) {
  const errors = new FieldErrors();
  if (q === null || q.length < 2 || q.length > 60) errors.add("q", "Type 2 to 60 characters.");
  errors.throwIfAny();
  const needle = q!.toLowerCase();
  const digits = q!.replace(/\s/g, "");
  const has = (text: string) => text.toLowerCase().includes(needle);
  const isGrower = user.role === "grower";
  const seesAll = user.role === "dispatcher" || user.role === "clerk";

  const channels = (await db.query<{ id: string; name: string }>("SELECT id, name FROM channel ORDER BY rail_order")).rows;
  const turnouts = (
    await db.query<{ code: string; channel_id: string; channel_name: string; grower_id: number; grower_name: string }>(
      `SELECT t.code, t.channel_id, c.name AS channel_name, t.grower_id, p.name AS grower_name
       FROM turnout t JOIN channel c ON c.id = t.channel_id JOIN person p ON p.id = t.grower_id ORDER BY c.rail_order, t.code`,
    )
  ).rows;
  const earliest = new Map<string, WindowFigures>();
  for (const w of await loadWindows(db)) {
    if (w.status !== "closed" && !earliest.has(w.channel_id)) earliest.set(w.channel_id, w);
  }
  const ownTurnouts = turnouts.filter((t) => t.grower_id === user.id);
  const capacityHref = (channelId: string) => `/channels/${channelId}/capacity`;
  /** A channel suggestion's link for the caller's role. */
  const channelHref = (channelId: string) => {
    const w = earliest.get(channelId);
    switch (user.role) {
      case "grower":
        return w ? `/grower/orders/new?window=${w.id}` : "/grower/orders/new";
      case "dispatcher":
        return w ? `/board?channels=${channelId}&window=${w.id}` : `/board?channels=${channelId}`;
      case "clerk":
      case "reviewer":
        return capacityHref(channelId);
      case "operator":
        return "/field";
    }
  };

  const found: Suggestion[] = [];
  for (const c of channels) {
    if (isGrower && !ownTurnouts.some((t) => t.channel_id === c.id)) continue;
    if (!has(c.name)) continue;
    const w = earliest.get(c.id);
    const detail = w
      ? `${formatMl(w.remaining_milli)} ML left, ${w.label}` +
        (w.restriction_cap_milli === null ? "" : `, restricted to ${formatMl(w.restriction_cap_milli)} ML/day`)
      : "No open windows";
    found.push({ kind: "channel", label: c.name, detail, href: channelHref(c.id) });
  }
  if (isGrower || seesAll) {
    for (const t of isGrower ? ownTurnouts : turnouts) {
      if (!has(t.code)) continue;
      found.push({
        kind: "turnout",
        label: t.code,
        detail: `${t.channel_name}, ${t.grower_name}`,
        href: isGrower ? "/grower" : user.role === "dispatcher" ? `/board?channels=${t.channel_id}` : capacityHref(t.channel_id),
      });
    }
  }
  if (seesAll) {
    const growers = (await db.query<{ id: number; name: string }>("SELECT id, name FROM person WHERE role = 'grower' ORDER BY id")).rows;
    for (const g of growers) {
      if (!has(g.name)) continue;
      const own = turnouts.filter((t) => t.grower_id === g.id);
      const ownChannels = [...new Set(own.map((t) => t.channel_id))];
      found.push({
        kind: "grower",
        label: g.name,
        detail: own.map((t) => t.code).join(", "),
        href: user.role === "dispatcher" ? `/board?channels=${ownChannels.join(",")}` : capacityHref(ownChannels[0]!),
      });
    }
  }
  if (isGrower || seesAll) {
    const operators = (
      await db.query<{ code: string; kind: "district" | "contractor"; name: string | null; phone: string | null; erased: boolean }>(
        "SELECT operator_code AS code, operator_kind AS kind, name, phone, erased FROM person WHERE operator_code IS NOT NULL ORDER BY operator_code",
      )
    ).rows;
    for (const o of operators) {
      const contractorMatch =
        o.kind === "contractor" && !o.erased &&
        (has(o.name!) || (/^\d+$/.test(digits) && o.phone!.replace(/\s/g, "").includes(digits)));
      if (!has(o.code) && !contractorMatch) continue;
      const contractor = o.kind === "contractor";
      found.push({
        kind: "operator",
        label: o.erased ? `Operator ${o.code}` : `${o.name} (${o.code})`,
        detail: contractor ? "Contractor" : "District operator",
        href: isGrower ? "/grower/orders/new" : contractor ? "/contractors" : user.role === "dispatcher" ? "/board" : "/packs",
      });
    }
  }
  found.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.label.localeCompare(b.label));
  return { suggestions: found.slice(0, LIMIT) };
}
