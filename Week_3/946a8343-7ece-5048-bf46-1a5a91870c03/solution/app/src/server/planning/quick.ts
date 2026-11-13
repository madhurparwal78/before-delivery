// Runs the quick actions of a comment against an issue's working state, in order. Each returns the sentences it produced:
// the result text that becomes a system note and an announcement, or `Could not apply /<action>: <reason>.`.
import type { Tx } from "../db.ts";
import type { ProjectRow } from "../access.ts";
import { parseDuration, parseNames, parseWeight, type QuickAction } from "../lib/quick-actions.ts";
import { isDate } from "./burndown.ts";
import { promoteIssue } from "./epics.ts";
import { findIssue, linkIssues, type Actor, type IssueRow, type Resolver } from "./issues-core.ts";
import {
  addSpent, changeAssignees, changeLabels, setConfidential, setDueDate, setEstimate, setIssueState, setMilestone, setTitle, setWeight,
  type IssueState,
} from "./issue-state.ts";
import { mayRead, type Viewer } from "./visibility.ts";
import { titleProblem } from "./util.ts";

interface QuickContext {
  readonly tx: Tx;
  readonly project: ProjectRow;
  readonly row: IssueRow;
  readonly state: IssueState;
  readonly actor: Actor;
  readonly viewer: Viewer;
  readonly resolver: Resolver;
}

const failure = (action: QuickAction, reason: string): string => `Could not apply /${action.name}: ${reason}.`;

async function relate(ctx: QuickContext, action: QuickAction): Promise<string[]> {
  const match = /^#?(\d+)$/u.exec(action.args);
  const target = match === null ? undefined : await findIssue(ctx.tx, ctx.project.id, Number(match[1]));
  if (target === undefined || target.id === ctx.row.id || !(await mayRead(ctx.tx, ctx.viewer, target))) {
    return [failure(action, `issue ${action.args} doesn't exist`)];
  }
  return (await linkIssues(ctx.tx, ctx.project, ctx.row, target, "relates")) ? [`Linked #${target.iid}.`] : [];
}

async function run(ctx: QuickContext, action: QuickAction): Promise<string[]> {
  const { state, resolver } = ctx;
  switch (action.name) {
    case "assign": {
      const names = parseNames(action.args, "@");
      const results: string[] = [];
      const valid: string[] = [];
      for (const name of names) {
        if (await resolver.userExists(name)) valid.push(name);
        else results.push(failure(action, `user @${name} doesn't exist`));
      }
      return [...changeAssignees(state, valid, []), ...results];
    }
    case "unassign": {
      const names = action.args === "" ? [...state.assignees] : parseNames(action.args, "@");
      return changeAssignees(state, [], names);
    }
    case "label": {
      const names = parseNames(action.args, "~");
      const valid: string[] = [];
      const results: string[] = [];
      for (const name of names) {
        if (await resolver.hasLabel(name)) valid.push(name);
        else results.push(failure(action, `label ~${name} doesn't exist`));
      }
      return [...changeLabels(state, valid, []), ...results];
    }
    case "unlabel": {
      const names = parseNames(action.args, "~");
      const present: string[] = [];
      const results: string[] = [];
      for (const name of names) {
        if (state.labels.includes(name) || (await resolver.hasLabel(name))) present.push(name);
        else results.push(failure(action, `label ~${name} doesn't exist`));
      }
      return [...changeLabels(state, [], present), ...results];
    }
    case "milestone": {
      const name = parseNames(action.args, "%")[0];
      if (name === undefined) return [];
      const milestone = await resolver.milestoneByTitle(name);
      if (milestone === undefined) return [failure(action, `milestone %${name} doesn't exist`)];
      return setMilestone(state, milestone);
    }
    case "weight": {
      const weight = parseWeight(action.args);
      return weight === null ? [failure(action, "weight must be 0 to 100")] : setWeight(state, weight);
    }
    case "estimate": {
      const minutes = parseDuration(action.args);
      if (minutes === null) return [failure(action, `invalid duration ${action.args}`)];
      return setEstimate(state, minutes);
    }
    case "spend": {
      const minutes = parseDuration(action.args);
      return minutes === null ? [failure(action, `invalid duration ${action.args}`)] : addSpent(state, minutes);
    }
    case "due": {
      if (!isDate(action.args)) return [failure(action, `invalid date ${action.args}`)];
      return setDueDate(state, action.args);
    }
    case "close":
      return setIssueState(state, "closed");
    case "reopen":
      return setIssueState(state, "opened");
    case "confidential":
      return setConfidential(state, true);
    case "relate":
      return relate(ctx, action);
    case "promote": {
      if (state.epicId !== null) return [];
      const epic = await promoteIssue(ctx.tx, ctx.project, ctx.row, state, ctx.actor);
      return [`Promoted to epic &${epic.iid}.`];
    }
    case "title": {
      const problem = titleProblem(action.args);
      return problem === null ? setTitle(state, action.args.trim()) : [failure(action, problem.replace(/\.$/u, "").replace(/^Title/u, "title"))];
    }
  }
}

export async function runQuickActions(ctx: QuickContext, actions: readonly QuickAction[]): Promise<string[]> {
  const results: string[] = [];
  for (const action of actions) results.push(...(await run(ctx, action)));
  return results;
}
