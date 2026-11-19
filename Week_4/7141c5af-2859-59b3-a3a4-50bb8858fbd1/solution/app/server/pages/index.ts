import { register as publicPages } from "./public.ts";
import { register as deskPages } from "./desk.ts";
import { register as clientPage } from "./clientPage.ts";

export function registerPages(): void {
  for (const register of [publicPages, deskPages, clientPage]) register();
}
