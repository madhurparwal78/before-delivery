package sim

import (
	"sort"
)

// sortedEnemies returns enemies ordered by id for a stable snapshot.
func sortedEnemies(m map[string]*Enemy) []*Enemy {
	ids := make([]string, 0, len(m))
	for id := range m {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	out := make([]*Enemy, 0, len(ids))
	for _, id := range ids {
		out = append(out, m[id])
	}
	return out
}

// sortedBarrels returns barrels ordered by id.
func sortedBarrels(m map[string]*Barrel) []*Barrel {
	ids := make([]string, 0, len(m))
	for id := range m {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	out := make([]*Barrel, 0, len(ids))
	for _, id := range ids {
		out = append(out, m[id])
	}
	return out
}

// sortedGrenades returns grenades ordered by id.
func sortedGrenades(m map[string]*Grenade) []*Grenade {
	ids := make([]string, 0, len(m))
	for id := range m {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	out := make([]*Grenade, 0, len(ids))
	for _, id := range ids {
		out = append(out, m[id])
	}
	return out
}

// vehiclesInSeatOrder returns vehicles in seat order.
func (r *Room) vehiclesInSeatOrder() []*Vehicle {
	out := []*Vehicle{}
	for _, p := range r.PlayersInSeatOrder() {
		if v := r.Vehicles[p.ID]; v != nil {
			out = append(out, v)
		}
	}
	return out
}
