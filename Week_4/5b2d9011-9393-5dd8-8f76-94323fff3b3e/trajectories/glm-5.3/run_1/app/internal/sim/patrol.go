package sim

// Patrol direction helpers: the enemy stores direction in TargetID while
// patrolling to avoid another field; a cleaner approach is a dedicated flag,
// so these helpers wrap a small bool stored in the Enemy struct's patrol
// memory.
func patrolDirection(e *Enemy) bool {
	if e.patrolLeft {
		return true
	}
	return false
}

func (e *Enemy) patrolDir() bool { return e.patrolLeft }

func (e *Enemy) flipPatrol() { e.patrolLeft = !e.patrolLeft }
