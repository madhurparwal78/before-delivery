// The pack reader's brain: every read, lineup choice, search choice and history move goes through `choose`, and only the
// latest one ever reaches the stage, the mirror, the status and the address.
import { COPY } from "../../shared/copy";
import type { PackFacts, SkuDetail } from "../../shared/types";
import { ApiFailure, LostRequest, get, isAbort } from "../lib/net";

export type Source = "reader" | "lineup" | "search" | "history" | "load" | "day";
type Request = { kind: "batch"; code: string } | { kind: "sku"; code: string } | { kind: "default" };
const DEFAULT_SKU = "KP-200-CTN";

interface PackHost {
  apply(facts: PackFacts): void;
  status(source: Source, message: string): void;
  limited(retryAfter: number, message: string): void;
  isLimited(): boolean;
  waitMessage(): string | null;
}

type Outcome = "applied" | "cancelled" | "failed" | "limited";

export class PackReader {
  private token = 0;
  private controller: AbortController | null = null;
  constructor(private readonly host: PackHost) {}

  cancel(): void {
    this.token++;
    this.controller?.abort();
  }

  /** `address`: how the address changes when the answer is applied. */
  async choose(req: Request, source: Source, address: "push" | "none"): Promise<Outcome> {
    const mine = ++this.token;
    this.controller?.abort();
    const controller = (this.controller = new AbortController());
    const live = () => mine === this.token;
    if (source === "reader") this.host.status("reader", "Reading your pack.");
    else if (source !== "day") this.host.status(source, "");
    if (source === "history" && this.host.isLimited()) {
      // a history move while limited keeps the stage and shows the wait message
      this.host.status(source, this.host.waitMessage() ?? "");
      return "limited";
    }
    try {
      const facts = await this.fetch(req, controller.signal);
      if (!live()) return "cancelled";
      this.host.apply(facts);
      if (address === "push") {
        const path = req.kind === "batch" ? `/?batch=${encodeURIComponent(facts.batchCode)}` : `/?sku=${encodeURIComponent(facts.skuCode)}`;
        history.pushState({}, "", path);
      }
      if (source === "reader") this.host.status("reader", `Batch ${facts.batchCode} read.`);
      else if (source !== "day") this.host.status(source, "");
      return "applied";
    } catch (error) {
      if (isAbort(error) || !live()) return "cancelled";
      return this.fail(req, source, error);
    }
  }

  private async fail(req: Request, source: Source, error: unknown): Promise<Outcome> {
    if (error instanceof ApiFailure && error.status === 429) {
      this.host.limited(error.retryAfter ?? 1, error.body.message);
      return "limited";
    }
    if (error instanceof ApiFailure && (error.status === 404 || error.status === 422)) {
      const sentence = req.kind === "sku" ? COPY.unknownPack : COPY.unknownBatch;
      if (source === "load" || source === "history") {
        // an address that cannot be read shows its sentence over the default stage
        try {
          const fallback = await this.fetch({ kind: "default" }, new AbortController().signal);
          this.host.apply(fallback);
        } catch {
          /* the stage keeps what it has */
        }
      }
      this.host.status(source, sentence);
      return "failed";
    }
    this.host.status(source, error instanceof LostRequest ? COPY.unavailable : COPY.unavailable);
    return "failed";
  }

  private async fetch(req: Request, signal: AbortSignal): Promise<PackFacts> {
    if (req.kind === "batch") return get<PackFacts>(`/api/batches/${encodeURIComponent(req.code)}`, { signal });
    const code = req.kind === "sku" ? req.code : DEFAULT_SKU;
    return (await get<SkuDetail>(`/api/skus/${encodeURIComponent(code)}`, { signal })).storyBatch;
  }
}

/** The address decides: batch outranks sku; neither means the default story batch. */
export function requestFromAddress(search: string): Request {
  const q = new URLSearchParams(search);
  const batch = q.get("batch");
  if (batch) return { kind: "batch", code: batch.trim().toUpperCase() };
  const sku = q.get("sku");
  if (sku) return { kind: "sku", code: sku.trim() };
  return { kind: "default" };
}
