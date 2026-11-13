import { test } from "node:test";
import assert from "node:assert/strict";
import { judge, rollup, statusFor, type GraphJob, type JobStatus } from "../src/server/ci/status.ts";

const job = (name: string, stageIndex: number, status: JobStatus, allowFailure = false): GraphJob => ({ name, stageIndex, status, allowFailure });
const rolled = (...statuses: [JobStatus, boolean?][]) => rollup(statuses.map(([status, allowFailure]) => ({ status, allowFailure: allowFailure ?? false })));

test("rollup: the first matching rule wins", () => {
  assert.equal(rolled(["created"], ["created"]), "created");
  assert.equal(rolled(["success"], ["created"]), "running");
  assert.equal(rolled(["failed"], ["pending"]), "running");
  assert.equal(rolled(["success"], ["manual"]), "blocked");
  assert.equal(rolled(["success"], ["manual", true]), "success");
  assert.equal(rolled(["failed"], ["manual"]), "blocked");
  assert.equal(rolled(["failed"], ["canceled"]), "failed");
  assert.equal(rolled(["canceled"], ["warning"]), "canceled");
  assert.equal(rolled(["warning"], ["success"]), "warning");
  assert.equal(rolled(["skipped"], ["skipped"]), "skipped");
  assert.equal(rolled(["skipped"], ["success"]), "success");
  assert.equal(rolled(["success"], ["scheduled"]), "scheduled");
  assert.equal(rolled(["success"], ["success"]), "success");
});

test("judge: stage order waits for every earlier job", () => {
  const latest = [job("a", 0, "success"), job("b", 0, "running")];
  assert.equal(judge({ stageIndex: 1, needs: null, when: "on_success" }, latest), "wait");
  assert.equal(judge({ stageIndex: 0, needs: null, when: "on_success" }, latest), "go");
});

test("judge: on_success, on_failure and always", () => {
  const failed = [job("a", 0, "failed")];
  assert.equal(judge({ stageIndex: 1, needs: null, when: "on_success" }, failed), "skip");
  assert.equal(judge({ stageIndex: 1, needs: null, when: "on_failure" }, failed), "go");
  assert.equal(judge({ stageIndex: 1, needs: null, when: "always" }, failed), "go");
  const fine = [job("a", 0, "success"), job("b", 0, "warning"), job("c", 0, "skipped")];
  assert.equal(judge({ stageIndex: 1, needs: null, when: "on_success" }, fine), "go");
  assert.equal(judge({ stageIndex: 1, needs: null, when: "on_failure" }, fine), "skip");
  assert.equal(judge({ stageIndex: 0, needs: null, when: "on_failure" }, []), "skip");
});

test("judge: an unplayed manual job blocks only when it may not fail, and never counts for needs", () => {
  const optional = [job("gate", 0, "manual", true)];
  assert.equal(judge({ stageIndex: 1, needs: null, when: "on_success" }, optional), "go");
  assert.equal(judge({ stageIndex: 1, needs: ["gate"], when: "on_success" }, optional), "wait");
  const blocking = [job("gate", 0, "manual", false)];
  assert.equal(judge({ stageIndex: 1, needs: null, when: "on_success" }, blocking), "wait");
});

test("judge: needs look only at the named jobs", () => {
  const latest = [job("a", 0, "success"), job("slow", 0, "running"), job("bad", 0, "failed")];
  assert.equal(judge({ stageIndex: 1, needs: ["a"], when: "on_success" }, latest), "go");
  assert.equal(judge({ stageIndex: 1, needs: ["a", "slow"], when: "on_success" }, latest), "wait");
  assert.equal(judge({ stageIndex: 1, needs: ["bad"], when: "on_success" }, latest), "skip");
  assert.equal(judge({ stageIndex: 1, needs: [], when: "on_success" }, latest), "go");
});

test("statusFor: manual and delayed jobs wait", () => {
  assert.deepEqual(["on_success", "on_failure", "always", "manual", "delayed"].map((when) => statusFor(when as "manual")), ["pending", "pending", "pending", "manual", "scheduled"]);
});
