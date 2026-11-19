/** The Send payment draft and its home: the page address. Parameters appear in a published order; empty ones and method=ach are left out. */
import { PAYMENT_METHODS } from "../../shared/rules.js";

export interface Draft {
  source: string;
  recipient: string;
  method: string;
  amount: string;
  memo: string;
  sendOn: string;
}

type Step = "form" | "review";

export const EMPTY_DRAFT: Draft = { source: "", recipient: "", method: "ach", amount: "", memo: "", sendOn: "" };

export function draftAddress(draft: Draft, step: Step): string {
  const params = new URLSearchParams();
  if (draft.source) params.set("source", draft.source);
  if (draft.recipient) params.set("recipient", draft.recipient);
  if (draft.method && draft.method !== "ach") params.set("method", draft.method);
  if (draft.amount) params.set("amount", draft.amount);
  if (draft.memo) params.set("memo", draft.memo);
  if (draft.sendOn) params.set("send_on", draft.sendOn);
  if (step === "review") params.set("step", "review");
  const text = params.toString();
  return text === "" ? "/payments/new" : `/payments/new?${text}`;
}

/** The draft in an address, before its ids are checked against what the company owns. */
export function readDraft(search: string): { draft: Draft; step: Step } {
  const params = new URLSearchParams(search);
  const method = params.get("method") ?? "ach";
  return {
    draft: {
      source: params.get("source") ?? "",
      recipient: params.get("recipient") ?? "",
      method,
      amount: params.get("amount") ?? "",
      memo: params.get("memo") ?? "",
      sendOn: params.get("send_on") ?? "",
    },
    step: params.get("step") === "review" ? "review" : "form",
  };
}

export function knownMethod(method: string): boolean {
  return (PAYMENT_METHODS as readonly string[]).includes(method);
}
