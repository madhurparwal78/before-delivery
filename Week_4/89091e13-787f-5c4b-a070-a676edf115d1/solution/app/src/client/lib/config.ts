import type { DisplayConfig } from "../../shared/api.ts";

export const display: DisplayConfig = JSON.parse((document.getElementById("display-config") as HTMLElement).textContent as string);
