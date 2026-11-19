// Follower digests (brief: Business rules > Digest). Rows are created by the lift; any instance sends them.
// Each pending row is claimed with SKIP LOCKED and marked sent in the same transaction as the send, so a
// digest goes out once however many instances retry.
import { config } from "./config.js";
import { one, transaction } from "./db.js";
import { Unavailable } from "./errors.js";
import { clusterOrUnknown } from "./records.js";
import { sendMail } from "./mail.js";

interface DigestFacts {
  title: string;
  publicDescription: string;
  publicItemCount: number;
  ownerHandle: string;
  clusterId: string;
}

/** The four public lines of the digest body. */
function digestBody(facts: DigestFacts): string[] {
  const oneLine = (value: string): string => value.replace(/\r\n|\r|\n/g, " ");
  return [
    oneLine(facts.title),
    oneLine(facts.publicDescription),
    `${facts.publicItemCount} public items by @${facts.ownerHandle}`,
    `${config.publicUrl}/c/${facts.clusterId}`,
  ];
}

interface PendingDigest {
  id: string;
  cluster_id: string;
  email: string;
}

/** Sends pending digests until none are left; stops at the first mail failure and leaves the rest pending. */
export async function sendPendingDigests(): Promise<void> {
  for (;;) {
    try {
      const sent = await transaction(async (client) => {
        const digest = await one<PendingDigest>(
          client,
          `SELECT d.id, d.cluster_id, f.email FROM digests d JOIN accounts f ON f.id = d.follower_id
           WHERE d.sent_at IS NULL ORDER BY d.created_at FOR UPDATE OF d SKIP LOCKED LIMIT 1`,
        );
        if (!digest) return false;
        const cluster = await clusterOrUnknown(client, digest.cluster_id);
        await sendMail({
          to: digest.email,
          subject: `New from ${cluster.owner_name}: ${cluster.title}`,
          lines: digestBody({
            title: cluster.title,
            publicDescription: cluster.public_description,
            publicItemCount: cluster.public_item_count,
            ownerHandle: cluster.owner_handle,
            clusterId: cluster.id,
          }),
        });
        await client.query("UPDATE digests SET sent_at = now() WHERE id = $1", [digest.id]);
        return true;
      });
      if (!sent) return;
    } catch (error) {
      if (error instanceof Unavailable) return;
      throw error;
    }
  }
}
