import type { Role } from "../shared/enums.js";

export type Person = {
  kind: "staff" | "member";
  id: string;
  name: string;
  role: Role;
};

