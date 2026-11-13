-- Incident engine additions (incident*.go).
--
-- alerts.service_id: the service the alert lives on, so a split opens its incident there and a drill's alert
--   (no routing key) is told apart per service.
-- incidents.decided_at: the second of the decision that stands (acknowledged, snoozed or resolved); with decided_by it
--   answers every decision conflict.
-- incidents.escalation_due_at: the deadline of the running escalation level; null when none runs.
-- incidents.policy_held: the holders come from the policy's level (false once a person was named by a reassign), which
--   is what a handoff of a schedule target moves.
alter table alerts add column if not exists service_id text references services (id);
alter table incidents add column if not exists decided_at timestamptz;
alter table incidents add column if not exists escalation_due_at timestamptz;
alter table incidents add column if not exists policy_held boolean not null default true;
