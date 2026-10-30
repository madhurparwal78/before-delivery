// A backing service did not answer. The pipeline turns it into 503 payment_unavailable / storage_unavailable.
type Service = "killbill" | "minio" | "smtp";

export class ServiceDown extends Error {
  constructor(readonly service: Service, cause?: unknown) {
    super(`${service} unavailable${cause instanceof Error ? `: ${cause.message}` : ""}`, { cause });
  }
}
