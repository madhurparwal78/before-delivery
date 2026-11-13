// The generative-AI render provider's HTTP API (WireMock stands in at WIREMOCK_URL).
import { config } from "../config.js";
import { ServiceDown } from "./reach.js";

type SubmitOutcome = { kind: "accepted"; providerJobId: string } | { kind: "rejected"; status: number } | { kind: "retry"; reason: string };

/** POST /v1/renders with the job reference as the idempotency key. 5xx, >10 s or no connection: retry later. */
export async function submitRender(jobRef: string, body: unknown): Promise<SubmitOutcome> {
  let response: Response;
  try {
    response = await fetch(`${config.render.url}/v1/renders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": jobRef },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ServiceDown("renderProvider");
  }
  if (response.status >= 500) return { kind: "retry", reason: `provider answered ${response.status}` };
  if (response.status >= 400) return { kind: "rejected", status: response.status };
  const answer = (await response.json().catch(() => ({}))) as { providerJobId?: string };
  return response.status === 202 && answer.providerJobId
    ? { kind: "accepted", providerJobId: answer.providerJobId }
    : { kind: "retry", reason: `unexpected provider answer ${response.status}` };
}
