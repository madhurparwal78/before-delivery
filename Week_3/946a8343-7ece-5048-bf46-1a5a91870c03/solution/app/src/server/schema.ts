import core from "./schema/core.sql";
import repo from "./schema/repo.sql";
import mr from "./schema/mr.sql";
import ci from "./schema/ci.sql";
import train from "./schema/train.sql";
import planning from "./schema/planning.sql";
import admin from "./schema/admin.sql";

// Applied in order on every start; later files may reference earlier tables.
export const SCHEMA_SQL: readonly string[] = [core, repo, planning, mr, ci, train, admin];
