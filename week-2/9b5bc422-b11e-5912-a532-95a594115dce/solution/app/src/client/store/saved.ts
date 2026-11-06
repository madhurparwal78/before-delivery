import { announce } from "./announcer.ts";
import { allSaved, onDurable } from "./workspace.ts";

const AFTER_TYPING_MS = 300;

let awaiting = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function announceWhenDurable(): void {
  timer = null;
  if (!awaiting || !allSaved()) return;
  awaiting = false;
  announce("Saved on this device.");
}

/** A person's content edit: `Saved on this device.` follows once it is durable and typing has stopped. */
export function noteContentEdit(): void {
  awaiting = true;
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(announceWhenDurable, AFTER_TYPING_MS);
}

onDurable(() => {
  if (awaiting && timer === null) announceWhenDurable();
});
