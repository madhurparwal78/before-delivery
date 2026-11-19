// Invites, mails, unbonding release and bad-encoding rejection journeys.

import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { Buffer } from "node:buffer";

const BASE = "http://127.0.0.1:4173";
const GRADING_KEY = process.env.GRADING_KEY ?? "gf-grading-7c19e4";
let failures = 0;
let checks = 0;

function check(name: string, condition: boolean, detail?: unknown): void {
  checks++;
  if (!condition) {
    failures++;
    console.log(`FAIL ${name}`, detail !== undefined ? JSON.stringify(detail) : "");
  } else {
    console.log(`ok   ${name}`);
  }
}

async function api(path: string, init: RequestInit = {}, cookie?: string): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

async function mailpit(path: string): Promise<unknown> {
  const response = await fetch(`http://mailpit:8025${path}`);
  return response.json();
}

async function waitForServer(timeoutMs = 20000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return;
    } catch {
      // retry
    }
    await delay(250);
  }
  throw new Error("server did not start");
}

interface Seed {
  workspaces: { fernhill: { id: string; name: string } };
  people: Record<string, { session: string }>;
  validators: Record<string, Record<string, { id: string; name: string }>>;
}

async function main(): Promise<void> {
  const server = spawn("node", ["dist/server/main.js"], { cwd: "/app", stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (chunk: Buffer) => process.stdout.write(chunk));
  server.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
  try {
    await waitForServer();
    await fetch("http://mailpit:8025/api/v1/messages", { method: "DELETE" });
    const seedResponse = await api("/api/grading/seed", {
      method: "POST",
      headers: { "X-Grading-Key": GRADING_KEY },
      body: JSON.stringify({}),
    });
    const seed = seedResponse.body as Seed;
    const ws = seed.workspaces.fernhill.id;
    const ownerCookie = `fs_session=${seed.people.amara.session}`;
    const felixCookie = `fs_session=${seed.people.felix.session}`;

    // --- The seed itself sends no mail.
    const messagesBefore = (await mailpit("/api/v1/messages")) as { messages: { Subject: string }[] };
    check("seed sends no mail", messagesBefore.messages.length === 0, messagesBefore.messages.map((m) => m.Subject));

    // --- Invite journey: the owner invites a new developer.
    const inviteResponse = await api(
      `/api/w/${ws}/invites`,
      { method: "POST", body: JSON.stringify({ email: "new.member@fernhill.test", role: "developer" }) },
      ownerCookie,
    );
    check("invite status", inviteResponse.status === 201, inviteResponse.status);

    // The sender retries every few seconds; wait for the first delivery.
    await delay(6000);
    const inviteMail = (await mailpit("/api/v1/messages")) as {
      messages: { ID: string; To: { Address: string }[]; Subject: string; Snippet: string }[];
    };
    check("one invite mail queued", inviteMail.messages.length === 1, inviteMail.messages.map((m) => m.Subject));
    const inviteMails = inviteMail.messages;
    check("invite mail subject", inviteMail.messages[0]?.Subject === "Join Fernhill Labs on Fernsquare", inviteMail.messages[0]?.Subject);
    const inviteMailBody = (await mailpit(`/api/v1/message/${inviteMails[0]?.ID}`)) as { Text: string };
    const inviteLink = inviteMailBody.Text.match(/\/invites\/[a-f0-9]+/)?.[0];
    check("invite mail holds the link", typeof inviteLink === "string" && inviteLink.startsWith("/invites/"), inviteLink);

    // The invitee opens the link and accepts.
    const token = inviteLink!.replace("/invites/", "");
    const inviteInfo = await api(`/api/invites/${token}`);
    check("invite info status", inviteInfo.status === 200, inviteInfo.status);
    const accept = await api(`/api/invites/${token}/accept`, {
      method: "POST",
      body: JSON.stringify({ name: "Nova Reyes", password: "nova-password-1" }),
    });
    check("invite accept status", accept.status === 200, accept.status);
    const acceptBody = accept.body as { workspaceId: string };
    check("invite accept lands on the workspace", acceptBody.workspaceId === ws, acceptBody.workspaceId);

    // The link is single-use now.
    const reuse = await api(`/api/invites/${token}/accept`, {
      method: "POST",
      body: JSON.stringify({ name: "Again", password: "password-2" }),
    });
    check("invite reuse is 410", reuse.status === 410, reuse.status);

    // --- Unbonding journey: Felix undelegates his Birch stake.
    const birch = seed.validators.fernhill.birch.id;
    const undelegate = await api(
      `/api/w/${ws}/staking/undelegate`,
      { method: "POST", body: JSON.stringify({ validator: birch, amount: "300" }) },
      felixCookie,
    );
    check("undelegate status", undelegate.status === 201, undelegate.status);

    // Produce the block that includes it.
    await api("/api/grading/clock", {
      method: "POST",
      headers: { "X-Grading-Key": GRADING_KEY },
      body: JSON.stringify({ advanceMs: 15000 }),
    });
    const felixStake = (await api(`/api/w/${ws}/staking/me`, {}, felixCookie)).body as {
      unbondings: { amountUfern: string; completesAt: string; status: string }[];
    };
    check("unbonding recorded", felixStake.unbondings.length === 1, felixStake.unbondings);
    check("unbonding status is unbonding", felixStake.unbondings[0]?.status === "unbonding", felixStake.unbondings[0]?.status);

    // Advance past the unbonding window (120s) and check the release.
    await api("/api/grading/clock", {
      method: "POST",
      headers: { "X-Grading-Key": GRADING_KEY },
      body: JSON.stringify({ advanceMs: 15000 }),
    });
    await api("/api/grading/clock", {
      method: "POST",
      headers: { "X-Grading-Key": GRADING_KEY },
      body: JSON.stringify({ advanceMs: 120000 }),
    });
    const felixStakeAfter = (await api(`/api/w/${ws}/staking/me`, {}, felixCookie)).body as {
      unbondings: { status: string }[];
    };
    check("unbonding released at its end instant", felixStakeAfter.unbondings[0]?.status === "released", felixStakeAfter.unbondings[0]);

    await delay(6000);
    const releaseMail = (await mailpit("/api/v1/messages")) as {
      messages: { Subject: string; To: { Address: string }[] }[];
    };
    check(
      "unbonding complete mail arrives",
      releaseMail.messages.some(
        (message) =>
          message.Subject.startsWith("Unbonding complete:") &&
          message.To.some((to) => to.Address === "felix.navarro@fernhill.test"),
      ),
      releaseMail.messages.map((m) => m.Subject),
    );

    // --- Bad encoding: the owner stages a badly encoded block.
    const heightBefore = ((await api(`/api/w/${ws}/blocks`, {}, ownerCookie)).body as { height: number }[])[0]!.height;
    await api(
      `/api/w/${ws}/producer`,
      { method: "PUT", body: JSON.stringify({ nextBlock: "bad-encoding" }) },
      ownerCookie,
    );
    await api("/api/grading/clock", {
      method: "POST",
      headers: { "X-Grading-Key": GRADING_KEY },
      body: JSON.stringify({ advanceMs: 15000 }),
    });
    await api("/api/grading/clock", {
      method: "POST",
      headers: { "X-Grading-Key": GRADING_KEY },
      body: JSON.stringify({ advanceMs: 15000 }),
    });
    const targetHeight = heightBefore + 1;
    const blocks = (await api(`/api/w/${ws}/blocks`, {}, ownerCookie)).body as { height: number; status: string }[];
    const newest = blocks.find((block) => block.height === targetHeight)!;
    check("bad encoding block produced", newest !== undefined, blocks.map((b) => b.height));
    check("bad encoding block rejected", newest.status === "rejected", newest.status);

    const fraud = (await api(`/api/w/${ws}/blocks/${newest.height}/fraud-proof`, {}, ownerCookie)).body as {
      axis: string;
      index: number;
    };
    check("fraud proof published", fraud.axis === "row" && fraud.index === 0, fraud);

    // Producer behaviour returns to Honest after one block.
    const workspaceAfter = (await api(`/api/w/${ws}`, {}, ownerCookie)).body as { nextBlock: string };
    check("producer returns to honest", workspaceAfter.nextBlock === "honest", workspaceAfter.nextBlock);

    // Rejection mail went to every member (after the sender's next tick).
    await delay(6000);
    const mails = (await mailpit("/api/v1/messages")) as {
      messages: { Subject: string; To: { Address: string }[] }[];
    };
    const rejectionMails = mails.messages.filter((message) => message.Subject === `Block ${newest.height} was rejected`);
    const fernhillMembers = ["amara.osei@fernhill.test", "felix.navarro@fernhill.test", "priya.raman@fernhill.test", "new.member@fernhill.test"];
    check(
      "one rejection mail per member",
      fernhillMembers.every((email) => rejectionMails.some((message) => message.To.some((to) => to.Address === email))),
      rejectionMails.flatMap((m) => m.To.map((t) => t.Address)),
    );

    // --- Withholding: the owner stages a withheld block and Wren rejects it.
    const heightBeforeWithhold = ((await api(`/api/w/${ws}/blocks`, {}, ownerCookie)).body as { height: number }[])[0]!.height;
    await api(
      `/api/w/${ws}/producer`,
      { method: "PUT", body: JSON.stringify({ nextBlock: "withhold" }) },
      ownerCookie,
    );
    await api("/api/grading/clock", {
      method: "POST",
      headers: { "X-Grading-Key": GRADING_KEY },
      body: JSON.stringify({ advanceMs: 15000 }),
    });
    // Wren auto-samples: give it enough intervals to hit the withheld region.
    await api("/api/grading/clock", {
      method: "POST",
      headers: { "X-Grading-Key": GRADING_KEY },
      body: JSON.stringify({ advanceMs: 30000 }),
    });
    const blocksAfter = (await api(`/api/w/${ws}/blocks`, {}, ownerCookie)).body as {
      height: number;
      status: string;
    }[];
    const withheldBlock = blocksAfter.find((block) => block.height === heightBeforeWithhold + 1)!;
    check("withheld block produced", withheldBlock !== undefined, { target: heightBeforeWithhold + 1, heights: blocksAfter.map((b) => b.height) });
    check("withheld block rejected", withheldBlock.status === "rejected", withheldBlock.status);
    const withheldDetail = (await api(`/api/w/${ws}/blocks/${withheldBlock.height}`, {}, ownerCookie)).body as {
      rejection: { reason: string; nodeName: string; row: number; col: number };
    };
    check(
      "withheld rejection names the node and share",
      withheldDetail.rejection.reason === "withheld" && withheldDetail.rejection.nodeName === "Wren" &&
        typeof withheldDetail.rejection.row === "number" && typeof withheldDetail.rejection.col === "number",
      withheldDetail.rejection,
    );

    console.log(`\n${checks - failures}/${checks} checks passed`);
    if (failures > 0) process.exitCode = 1;
  } finally {
    server.kill("SIGTERM");
    await delay(500);
    server.kill("SIGKILL");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
