import type { SessionUser } from "../shared/types.js";
import { Access, loadAccessRules, type AccessRule } from "./access.js";
import type { Tx } from "./db.js";
import { loadAssignmentRules, loadBusinessRules, loadFormPolicies, type AssignmentRule, type BusinessRule, type FormPolicy } from "./rules.js";
import { loadSlaCatalog, type SlaCatalog } from "./sla.js";
import { World } from "./world.js";

export interface Principal {
  user: SessionUser;
  /** The real person at the keyboard; differs from `user` while impersonating. */
  actor: string;
  actingFor: string | null;
}

export const SYSTEM: Principal = {
  user: { username: "system", display_name: "System", roles: [], department: "IT provider", time_zone: "Europe/Berlin" },
  actor: "system",
  actingFor: null,
};

/** Everything one request needs, loaded lazily inside one transaction. */
export class Env {
  private slaCatalogCache: Promise<SlaCatalog> | null = null;
  private rulesCache: Promise<BusinessRule[]> | null = null;
  private policiesCache: Promise<FormPolicy[]> | null = null;
  private assignmentCache: Promise<AssignmentRule[]> | null = null;
  private accessRulesCache: Promise<AccessRule[]> | null = null;

  constructor(
    readonly tx: Tx,
    readonly who: Principal,
    readonly world: World,
  ) {}

  static async create(tx: Tx, who: Principal): Promise<Env> {
    return new Env(tx, who, await World.load(tx));
  }

  get isSystem(): boolean {
    return this.who === SYSTEM;
  }

  get user(): SessionUser {
    return this.who.user;
  }

  get actorRef(): { username: string; roles: readonly string[] } {
    return { username: this.who.user.username, roles: this.who.user.roles };
  }

  slaCatalog(): Promise<SlaCatalog> {
    return (this.slaCatalogCache ??= loadSlaCatalog(this.tx));
  }

  businessRules(): Promise<BusinessRule[]> {
    return (this.rulesCache ??= loadBusinessRules(this.tx));
  }

  formPolicies(): Promise<FormPolicy[]> {
    return (this.policiesCache ??= loadFormPolicies(this.tx));
  }

  assignmentRules(): Promise<AssignmentRule[]> {
    return (this.assignmentCache ??= loadAssignmentRules(this.tx));
  }

  async access(): Promise<Access> {
    this.accessRulesCache ??= loadAccessRules(this.tx);
    return new Access({ username: this.user.username, roles: this.user.roles, department: this.user.department }, await this.accessRulesCache, this.world);
  }
}
