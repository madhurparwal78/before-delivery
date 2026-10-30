export const REQUEST_STATUSES = ['submitted', 'confirmed', 'declined'];
export const TRANSPORT_TYPES = ['tour', 'show', 'show_freight'];
export const TRUCK_STATUSES = ['available', 'assigned', 'maintenance'];
export const ROLES = ['admin', 'dispatcher', 'tour_manager'];
export const STOP_KINDS = ['pickup', 'delivery', 'first_show', 'last_show'];

export const STATUS_LABELS = {
  submitted: 'Submitted',
  confirmed: 'Confirmed',
  declined: 'Declined'
};

export const TRANSPORT_TYPE_LABELS = {
  tour: 'Tour',
  show: 'Show',
  show_freight: 'Show freight'
};

export const TRUCK_STATUS_LABELS = {
  available: 'Available',
  assigned: 'Assigned',
  maintenance: 'Maintenance'
};

export const DEPOT_LABELS = {
  north: 'North',
  south: 'South'
};

export const ROLE_LABELS = {
  admin: 'Admin',
  dispatcher: 'Dispatcher',
  tour_manager: 'Tour manager'
};

export const STOP_LABELS = {
  pickup: 'Pickup',
  delivery: 'Delivery',
  first_show: 'First Show',
  last_show: 'Last Show'
};

const ACTIVITY_DECISION_LABELS = {
  confirmed: 'Confirmed by',
  declined: 'Declined by'
};

const trucks = (count) => (count === 1 ? '1 truck' : `${count} trucks`);

export const truckCountLine = (assigned, requested) => `${assigned} of ${requested} trucks assigned`;

export const boardSummaryLine = ({ waiting, trucks_needed, trucks_available }) =>
  `${waiting} waiting, ${trucks(trucks_needed)} needed, ${trucks(trucks_available)} available`;

export const fleetSummaryLine = ({ available, assigned, maintenance }) =>
  `${available} available, ${assigned} assigned, ${maintenance} in maintenance`;

export const submittedActivityNote = (count) => `Requested ${trucks(count)}`;
export const assignedActivityNote = (truckId) => `${truckId} assigned`;
export const releasedActivityNote = (truckId) => `${truckId} released`;
export const decisionLine = (kind, name) => `${ACTIVITY_DECISION_LABELS[kind]} ${name}`;
