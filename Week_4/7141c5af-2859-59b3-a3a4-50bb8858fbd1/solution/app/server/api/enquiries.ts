import { config } from "../config.ts";
import { one } from "../db/pool.ts";
import { copy } from "../domain/copy.ts";
import { addSeconds, minuteCopy } from "../domain/time.ts";
import { tooMany } from "../http/errors.ts";
import { type Ctx, json, route } from "../http/router.ts";
import { oneLine, queueMail } from "../providers/mail.ts";
import { bodyOf, countInWindow, emailField, requiredText } from "./fields.ts";

const ENQUIRY_LIMIT = 3;
const CONSERVATOR_ADDRESS = "agnese@bottega-semenza.example";

const scopeOf = (email: string): string => `enquiry:${email.trim().toLowerCase()}`;

function refused(until: Date): Error {
  return tooMany("tooManyEnquiries", copy("F-12", { minute: minuteCopy(until) }), until);
}

/** The address read from a body that may not be readable: one with no address has nothing to count. */
function addressIn(raw: Buffer): string | null {
  try {
    const email = (JSON.parse(raw.toString("utf8")) as { email?: unknown } | null)?.email;
    return typeof email === "string" ? email : null;
  } catch {
    return null;
  }
}

/** Step 4 only reads the window: an enquiry counts once it is valid, after step 9. */
async function enquiryRate(ctx: Ctx): Promise<void> {
  const email = addressIn(ctx.raw);
  if (email === null) return;
  const window = await one<{ started_at: Date }>(
    `SELECT started_at FROM rate_windows WHERE scope = $1 AND count >= $2 AND started_at + make_interval(secs => $3) > now()`,
    [scopeOf(email), ENQUIRY_LIMIT, config.enquiryRateWindowSeconds],
  );
  if (window) throw refused(addSeconds(window.started_at, config.enquiryRateWindowSeconds));
}

export function register(): void {
  route({
    method: "POST",
    pattern: "/api/enquiries",
    access: "public",
    rate: enquiryRate,
    handle: async (ctx) => {
      const body = bodyOf(ctx);
      const name = oneLine(requiredText(body, "name", 120));
      const email = emailField(body);
      const message = requiredText(body, "message", 5000);
      const until = await countInWindow(scopeOf(email), ENQUIRY_LIMIT, config.enquiryRateWindowSeconds);
      if (until) throw refused(until);
      await queueMail({
        to: CONSERVATOR_ADDRESS,
        replyTo: email,
        subject: `Enquiry from ${name}`,
        body: `Name: ${name}\nAddress: ${email}\n\n${message}`,
      });
      return json(202, { received: true });
    },
  });
}
