import type { Hono } from "hono";
import { pool } from "../db";
import { type Env, authorize, reply } from "../http/context";
import { getPractice, nowOf } from "../store/practice";
import { clockView } from "../services/clock";
import { subscribe } from "../services/hub";
import { everythingAnswers, serviceView } from "../services/status";
import type { LiveEvent } from "../../shared/types";

const HEARTBEAT_MS = 15000;

export function registerLive(app: Hono<Env>): void {
  app.get("/api/events", async (c) => {
    const account = await authorize(c, { roles: "either" });
    const practice = await getPractice(pool, account.practiceId);
    const encoder = new TextEncoder();
    let cleanup = (): void => undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const write = (text: string): void => {
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            cleanup();
          }
        };
        const send = (event: LiveEvent): void => write(`data: ${JSON.stringify(event)}\n\n`);
        const unsubscribe = subscribe({ practiceId: account.practiceId, clientId: account.clientId, role: account.role, send });
        const heartbeat = setInterval(() => write(": keep-alive\n\n"), HEARTBEAT_MS);
        cleanup = () => {
          unsubscribe();
          clearInterval(heartbeat);
        };
        c.req.raw.signal.addEventListener("abort", cleanup);
        send({ type: "clock", clock: clockView(nowOf(practice)) });
        if (account.role === "bookkeeper") send({ type: "services", services: serviceView() });
      },
      cancel: () => cleanup(),
    });
    return new Response(stream, { headers: {
      "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    } });
  });

  app.get("/api/health", () => reply({ status: everythingAnswers() ? "ok" : "unavailable" }));
}
