// Package gamemap holds the seeded maps and the geometry the rules ask about:
// which cells are solid, what a ray hits first and whether a block stands between
// two points.
package gamemap

import "math"

// Block is a solid rectangle on the x/z plane, named by its south-west corner.
type Block struct {
	X float64 `json:"x"`
	Z float64 `json:"z"`
	W float64 `json:"w"`
	D float64 `json:"d"`
}

// Spawn is a seat's start place. Siege maps publish an aim, convoy maps a heading.
type Spawn struct {
	Seat    int      `json:"seat"`
	X       float64  `json:"x"`
	Z       float64  `json:"z"`
	Aim     *float64 `json:"aim,omitempty"`
	Heading *float64 `json:"heading,omitempty"`
}

// BarrelSpawn is a barrel's id and place.
type BarrelSpawn struct {
	ID string  `json:"id"`
	X  float64 `json:"x"`
	Z  float64 `json:"z"`
}

// EnemySpawn is an enemy's id, kind and place.
type EnemySpawn struct {
	ID   string  `json:"id"`
	Kind string  `json:"kind"`
	X    float64 `json:"x"`
	Z    float64 `json:"z"`
}

// Wave is one wave's spawn list. Wave 4 is the boss wave.
type Wave struct {
	Wave    int          `json:"wave"`
	Enemies []EnemySpawn `json:"enemies"`
}

// Checkpoint is a convoy checkpoint. Index 0 is the start/finish line.
type Checkpoint struct {
	Index int     `json:"index"`
	X     float64 `json:"x"`
	Z     float64 `json:"z"`
}

// Map is a seeded map exactly as the brief publishes it.
type Map struct {
	ID          string        `json:"id"`
	Width       float64       `json:"width"`
	Depth       float64       `json:"depth"`
	Blocks      []Block       `json:"blocks"`
	Spawns      []Spawn       `json:"spawns"`
	Barrels     []BarrelSpawn `json:"barrels"`
	Waves       []Wave        `json:"waves"`
	Checkpoints []Checkpoint  `json:"checkpoints"`
}

func aim(v float64) *float64 { return &v }

// Siege is the siege map id.
const Siege = "breakwater-yard"

// Convoy is the convoy map id.
const Convoy = "saltpan-loop"

var breakwaterYard = Map{
	ID:    Siege,
	Width: 32,
	Depth: 32,
	Blocks: []Block{
		{X: 8, Z: 14, W: 1, D: 1}, {X: 9, Z: 14, W: 1, D: 1}, {X: 10, Z: 14, W: 1, D: 1}, {X: 11, Z: 14, W: 1, D: 1},
		{X: 20, Z: 14, W: 1, D: 1}, {X: 21, Z: 14, W: 1, D: 1}, {X: 22, Z: 14, W: 1, D: 1}, {X: 23, Z: 14, W: 1, D: 1},
		{X: 15, Z: 22, W: 1, D: 1}, {X: 16, Z: 22, W: 1, D: 1}, {X: 15, Z: 23, W: 1, D: 1}, {X: 16, Z: 23, W: 1, D: 1},
		{X: 4, Z: 8, W: 1, D: 1}, {X: 27, Z: 8, W: 1, D: 1},
	},
	Spawns: []Spawn{
		{Seat: 1, X: 16, Z: 4, Aim: aim(90)},
		{Seat: 2, X: 14, Z: 4, Aim: aim(90)},
		{Seat: 3, X: 18, Z: 4, Aim: aim(90)},
		{Seat: 4, X: 16, Z: 6, Aim: aim(90)},
	},
	Barrels: []BarrelSpawn{
		{ID: "B1", X: 6.5, Z: 20.5},
		{ID: "B2", X: 8, Z: 20.5},
		{ID: "B3", X: 25.5, Z: 20.5},
		{ID: "B4", X: 16, Z: 25},
	},
	Waves: []Wave{
		{Wave: 1, Enemies: []EnemySpawn{
			{ID: "w1-1", Kind: "grunt", X: 10, Z: 28},
			{ID: "w1-2", Kind: "grunt", X: 16, Z: 28},
			{ID: "w1-3", Kind: "grunt", X: 22, Z: 28},
		}},
		{Wave: 2, Enemies: []EnemySpawn{
			{ID: "w2-1", Kind: "grunt", X: 4, Z: 28},
			{ID: "w2-2", Kind: "grunt", X: 10, Z: 28},
			{ID: "w2-3", Kind: "grunt", X: 16, Z: 30},
			{ID: "w2-4", Kind: "grunt", X: 22, Z: 28},
			{ID: "w2-5", Kind: "grunt", X: 28, Z: 28},
		}},
		{Wave: 3, Enemies: []EnemySpawn{
			{ID: "w3-1", Kind: "grunt", X: 4, Z: 28},
			{ID: "w3-2", Kind: "grunt", X: 10, Z: 28},
			{ID: "w3-3", Kind: "grunt", X: 22, Z: 28},
			{ID: "w3-4", Kind: "grunt", X: 28, Z: 28},
			{ID: "w3-5", Kind: "brute", X: 16, Z: 30},
		}},
		{Wave: 4, Enemies: []EnemySpawn{
			{ID: "w4-1", Kind: "boss", X: 16, Z: 30},
			{ID: "w4-2", Kind: "grunt", X: 6, Z: 28},
			{ID: "w4-3", Kind: "grunt", X: 26, Z: 28},
		}},
	},
	Checkpoints: []Checkpoint{},
}

var saltpanLoop = Map{
	ID:     Convoy,
	Width:  200,
	Depth:  120,
	Blocks: []Block{{X: 60, Z: 40, W: 80, D: 40}},
	Spawns: []Spawn{
		{Seat: 1, X: 20, Z: 8, Heading: aim(0)},
		{Seat: 2, X: 20, Z: 14, Heading: aim(0)},
		{Seat: 3, X: 14, Z: 8, Heading: aim(0)},
		{Seat: 4, X: 14, Z: 14, Heading: aim(0)},
	},
	Barrels: []BarrelSpawn{},
	Waves:   []Wave{},
	Checkpoints: []Checkpoint{
		{Index: 1, X: 100, Z: 12},
		{Index: 2, X: 180, Z: 60},
		{Index: 3, X: 100, Z: 108},
		{Index: 4, X: 20, Z: 60},
		{Index: 0, X: 24, Z: 11},
	},
}

// Get resolves a seeded map by id.
func Get(id string) (*Map, bool) {
	switch id {
	case Siege:
		return &breakwaterYard, true
	case Convoy:
		return &saltpanLoop, true
	}
	return nil, false
}

// ForMode resolves the map a room mode plays on.
func ForMode(mode string) *Map {
	if mode == "convoy" {
		return &saltpanLoop
	}
	return &breakwaterYard
}

// SolidAt reports whether a point lies inside a solid block cell.
func (m *Map) SolidAt(x, z float64) bool {
	for i := range m.Blocks {
		b := m.Blocks[i]
		if x >= b.X && x < b.X+b.W && z >= b.Z && z < b.Z+b.D {
			return true
		}
	}
	return false
}

// Outside reports whether a point lies off the map.
func (m *Map) Outside(x, z float64) bool {
	return x < 0 || x > m.Width || z < 0 || z > m.Depth
}

// Clamp holds a point inside the map edges.
func (m *Map) Clamp(x, z float64) (float64, float64) {
	return math.Min(math.Max(x, 0), m.Width), math.Min(math.Max(z, 0), m.Depth)
}

// SegmentBlocked reports whether the straight segment between two points passes
// through a solid block cell. Grazing a face is not passing through.
func (m *Map) SegmentBlocked(ax, az, bx, bz float64) bool {
	dx, dz := bx-ax, bz-az
	for i := range m.Blocks {
		if t0, t1, ok := slab(m.Blocks[i], ax, az, dx, dz); ok && t1 > t0 && t0 < 1 && t1 > 0 {
			return true
		}
	}
	return false
}

// RayBlockDistance reports how far along a unit direction the ray travels before
// it enters a solid block cell, or math.Inf(1) when it never does.
func (m *Map) RayBlockDistance(ox, oz, dx, dz float64) float64 {
	best := math.Inf(1)
	for i := range m.Blocks {
		t0, t1, ok := slab(m.Blocks[i], ox, oz, dx, dz)
		if !ok || t1 <= t0 || t1 <= 0 {
			continue
		}
		entry := t0
		if entry < 0 {
			entry = 0
		}
		if entry < best {
			best = entry
		}
	}
	return best
}

// slab intersects the parametric line origin+t*dir with a block, returning the
// entry and exit parameters.
func slab(b Block, ox, oz, dx, dz float64) (float64, float64, bool) {
	t0, t1 := math.Inf(-1), math.Inf(1)
	for _, axis := range [2]struct{ o, d, lo, hi float64 }{
		{ox, dx, b.X, b.X + b.W},
		{oz, dz, b.Z, b.Z + b.D},
	} {
		if axis.d == 0 {
			if axis.o < axis.lo || axis.o > axis.hi {
				return 0, 0, false
			}
			continue
		}
		near := (axis.lo - axis.o) / axis.d
		far := (axis.hi - axis.o) / axis.d
		if near > far {
			near, far = far, near
		}
		if near > t0 {
			t0 = near
		}
		if far < t1 {
			t1 = far
		}
		if t0 > t1 {
			return 0, 0, false
		}
	}
	return t0, t1, true
}
