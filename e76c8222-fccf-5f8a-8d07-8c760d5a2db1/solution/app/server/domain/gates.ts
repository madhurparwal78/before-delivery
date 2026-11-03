// The four dispatch gates: the single definition the dry-run and the pin both evaluate.
import type { GateResult } from "../../shared/api.js";
import { GATES, type CredentialType, type GateKey, type Setting } from "../../shared/domain.js";
import { agencyDate } from "../../shared/time.js";

const ACCEPTED_TYPES: Record<Setting, readonly CredentialType[]> = {
  medical: ["NIC", "CDI"],
  legal: ["SC:L"],
  education: ["EIPA-4.0", "NIC"],
  community: ["NIC", "CDI"],
};

const TRAVEL_BUFFER_MS = 30 * 60_000;

interface Commitment {
  ref: string;
  start: Date;
  end: Date;
}

interface GateInput {
  setting: Setting;
  start: Date;
  end: Date;
  consumerName: string;
  blockedByConsumer: boolean;
  credentials: { type: CredentialType; expiresOn: string }[];
  /** Accepted seats and active offers the interpreter holds elsewhere, in start order. */
  commitments: Commitment[];
}

function results(reasons: Record<GateKey, string | null>): GateResult[] {
  return GATES.map(({ gate, label }) => ({ gate, label, pass: reasons[gate] === null, reason: reasons[gate] }));
}

export function evaluateGates(input: GateInput): GateResult[] {
  const accepted = ACCEPTED_TYPES[input.setting];
  const held = input.credentials.filter((c) => accepted.includes(c.type));

  const credential = held.length ? null : `No ${input.setting} credential. Needs one of ${accepted.join(", ")}.`;

  let validity: string | null = "No credential to check.";
  const latest = held.reduce<(typeof held)[number] | null>(
    (best, c) => (best === null || c.expiresOn > best.expiresOn ? c : best),
    null,
  );
  if (latest) {
    validity = latest.expiresOn >= agencyDate(input.end) ? null : `${latest.type} expires ${latest.expiresOn}, before this assignment ends.`;
  }

  const clash = input.commitments.find(
    (c) =>
      !(
        c.end.getTime() + TRAVEL_BUFFER_MS <= input.start.getTime() ||
        c.start.getTime() >= input.end.getTime() + TRAVEL_BUFFER_MS
      ),
  );
  const schedule = clash ? `Too close to ${clash.ref}; jobs need a travel buffer.` : null;

  const consumer = input.blockedByConsumer ? `${input.consumerName} has blocked this interpreter.` : null;

  return results({ credential, validity, schedule, consumer });
}
