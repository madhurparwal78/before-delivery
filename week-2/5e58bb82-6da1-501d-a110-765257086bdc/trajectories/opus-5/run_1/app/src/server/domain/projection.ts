import type { Holiday, Mission, Role } from '../../shared/types.js';
import { isMissionActive } from './transitions.js';

/**
 * The one client projection. Client reviewers never see a holiday's nearest
 * vessel, never see a link state once the mission is no longer active, and never
 * see a thruster, service, ingest or acknowledgement field.
 */
export function projectMission(mission: Mission, role: Role): Mission {
  if (role !== 'client_reviewer') return mission;
  const active = isMissionActive(mission.status);
  return {
    ...mission,
    vessels: mission.vessels.map((vessel) => ({
      id: vessel.id,
      name: vessel.name,
      link_state: active ? vessel.link_state : null,
    })),
  };
}

export function projectHoliday(holiday: Holiday, role: Role): Holiday {
  if (role !== 'client_reviewer') return holiday;
  return { ...holiday, nearest_vessel: null };
}
