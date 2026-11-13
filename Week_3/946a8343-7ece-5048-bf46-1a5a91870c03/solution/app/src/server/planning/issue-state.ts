// The working copy of an issue while a change is applied, and the published system-note sentence of each field change.
// Quick actions, the PATCH route and board moves all go through these, so the sentences are decided once.
import { formatDuration, labelChange } from "../lib/quick-actions.ts";

export interface IssueState {
  title: string;
  description: string;
  state: "opened" | "closed";
  labels: string[];
  assignees: string[];
  milestone: { readonly id: number; readonly title: string } | null;
  weight: number | null;
  dueDate: string | null;
  estimate: number | null;
  spent: number;
  confidential: boolean;
  epicId: number | null;
}

export function copyState(state: IssueState): IssueState {
  return { ...state, labels: [...state.labels], assignees: [...state.assignees] };
}

export function changeLabels(state: IssueState, add: readonly string[], remove: readonly string[]): string[] {
  const change = labelChange(state.labels, add, remove);
  state.labels = change.labels;
  return change.notes;
}

export function changeAssignees(state: IssueState, add: readonly string[], remove: readonly string[]): string[] {
  const notes: string[] = [];
  for (const username of remove) {
    if (!state.assignees.includes(username)) continue;
    state.assignees = state.assignees.filter((name) => name !== username);
    notes.push(`Unassigned @${username}.`);
  }
  for (const username of add) {
    if (state.assignees.includes(username)) continue;
    state.assignees.push(username);
    notes.push(`Assigned @${username}.`);
  }
  return notes;
}

/** The setters report their sentence whenever they are called with a value; clearing a field has no published sentence. */
export function setMilestone(state: IssueState, milestone: { readonly id: number; readonly title: string } | null): string[] {
  state.milestone = milestone;
  return milestone === null ? [] : [`Set milestone %${milestone.title}.`];
}

export function setWeight(state: IssueState, weight: number | null): string[] {
  state.weight = weight;
  return weight === null ? [] : [`Set weight to ${weight}.`];
}

export function setEstimate(state: IssueState, minutes: number | null): string[] {
  state.estimate = minutes;
  return minutes === null ? [] : [`Set estimate to ${formatDuration(minutes)}.`];
}

export function addSpent(state: IssueState, minutes: number): string[] {
  state.spent += minutes;
  return [`Added ${formatDuration(minutes)} of time spent.`];
}

export function setDueDate(state: IssueState, date: string | null): string[] {
  state.dueDate = date;
  return date === null ? [] : [`Set due date to ${date}.`];
}

export function setConfidential(state: IssueState, confidential: boolean): string[] {
  const becomes = confidential && !state.confidential;
  state.confidential = confidential;
  return becomes ? ["Made confidential."] : [];
}

export function setTitle(state: IssueState, title: string): string[] {
  state.title = title;
  return [`Changed title to ${title}.`];
}

export function setIssueState(state: IssueState, next: "opened" | "closed"): string[] {
  if (state.state === next) return [];
  state.state = next;
  return [next === "closed" ? "Closed." : "Reopened."];
}
