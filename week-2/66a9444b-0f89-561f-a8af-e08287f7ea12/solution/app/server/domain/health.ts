// Health answers 200 whenever the process serves, with each backing service probed live.
import { databaseUp } from "../db/index.ts";
import { ok, route } from "../http.ts";
import { killbillUp } from "../services/killbill.ts";
import { mailUp } from "../services/smtp.ts";
import { storageUp } from "../services/storage.ts";

const word = (up: boolean) => (up ? "up" : "down");

route("GET", "/api/health", "public", async () => {
  const [postgres, killbill, mailpit, minio] = await Promise.all([databaseUp(), killbillUp(), mailUp(), storageUp()]);
  return ok({ status: "ok", services: { postgres: word(postgres), killbill: word(killbill), mailpit: word(mailpit), minio: word(minio) } });
});
