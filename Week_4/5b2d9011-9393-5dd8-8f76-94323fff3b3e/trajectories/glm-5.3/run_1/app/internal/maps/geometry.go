package maps

import "math"

// SolidAt reports whether the point (x, z) lies inside a solid block cell of
// the map. Siege cells are 1 x 1 m named by their south-west corner; convoy
// blocks are rectangles.
func (m Map) SolidAt(x, z float64) bool {
	// Cells are tested by their south-west corner: a point is inside the cell
	// covering [bx, bx+w) x [bz, bz+d).
	for _, b := range m.Blocks {
		if x >= float64(b.X) && x < float64(b.X)+float64(b.W) &&
			z >= float64(b.Z) && z < float64(b.Z)+float64(b.D) {
			return true
		}
	}
	return false
}

// SpawnFor returns the spawn for a seat.
func (m Map) SpawnFor(seat int) Spawn {
	for _, s := range m.Spawns {
		if s.Seat == seat {
			return s
		}
	}
	return Spawn{X: m.Width / 2, Z: m.Depth / 2, Aim: 90}
}

// StartFor returns the convoy start for a seat.
func (m Map) StartFor(seat int) VehicleStart {
	for _, s := range m.Starts {
		if s.Seat == seat {
			return s
		}
	}
	return VehicleStart{X: m.Width / 2, Z: m.Depth / 2, Heading: 0}
}

// CheckpointAt returns the checkpoint with the given id.
func (m Map) CheckpointAt(id string) (Checkpoint, bool) {
	for _, c := range m.Checkpoints {
		if c.ID == id {
			return c, true
		}
	}
	return Checkpoint{}, false
}

// Inside reports whether a point lies within the map bounds.
func (m Map) Inside(x, z float64) bool {
	return x >= 0 && x <= m.Width && z >= 0 && z <= m.Depth
}

// Distance is the Euclidean distance between two points.
func Distance(x1, z1, x2, z2 float64) float64 {
	return math.Hypot(x2-x1, z2-z1)
}

// SegmentBlocked reports whether the segment from (x1,z1) to (x2,z2) passes
// through a solid block cell. The cells are sampled at a fine step; map
// geometry keeps every cell at least 1 m wide.
func (m Map) SegmentBlocked(x1, z1, x2, z2 float64) bool {
	dx := x2 - x1
	dz := z2 - z1
	dist := math.Hypot(dx, dz)
	if dist == 0 {
		return m.SolidAt(x1, z1)
	}
	steps := int(dist*8) + 1
	for i := 1; i < steps; i++ {
		t := float64(i) / float64(steps)
		if m.SolidAt(x1+dx*t, z1+dz*t) {
			return true
		}
	}
	return false
}
