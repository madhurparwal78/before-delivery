package main

import (
	"math"
	"net/http"
)

type block struct{ x, z, w, d int }

type spawnPoint struct {
	seat    int
	x, z    float64
	heading float64
}

type barrelSpawn struct {
	id   string
	x, z float64
}

type enemySpawn struct {
	id   string
	kind string
	x, z float64
}

type checkpoint struct {
	id   string
	x, z float64
}

type gameMap struct {
	id          string
	width       float64
	depth       float64
	blocks      []block
	spawns      []spawnPoint
	barrels     []barrelSpawn
	waves       [][]enemySpawn
	checkpoints []checkpoint
}

var breakwaterYard = &gameMap{
	id: "breakwater-yard", width: 32, depth: 32,
	blocks: []block{
		{8, 14, 1, 1}, {9, 14, 1, 1}, {10, 14, 1, 1}, {11, 14, 1, 1},
		{20, 14, 1, 1}, {21, 14, 1, 1}, {22, 14, 1, 1}, {23, 14, 1, 1},
		{15, 22, 1, 1}, {16, 22, 1, 1}, {15, 23, 1, 1}, {16, 23, 1, 1},
		{4, 8, 1, 1}, {27, 8, 1, 1},
	},
	spawns:  []spawnPoint{{1, 16, 4, 90}, {2, 14, 4, 90}, {3, 18, 4, 90}, {4, 16, 6, 90}},
	barrels: []barrelSpawn{{"B1", 6.5, 20.5}, {"B2", 8, 20.5}, {"B3", 25.5, 20.5}, {"B4", 16, 25}},
	waves: [][]enemySpawn{
		{{"w1-1", "grunt", 10, 28}, {"w1-2", "grunt", 16, 28}, {"w1-3", "grunt", 22, 28}},
		{{"w2-1", "grunt", 4, 28}, {"w2-2", "grunt", 10, 28}, {"w2-3", "grunt", 16, 30}, {"w2-4", "grunt", 22, 28}, {"w2-5", "grunt", 28, 28}},
		{{"w3-1", "grunt", 4, 28}, {"w3-2", "grunt", 10, 28}, {"w3-3", "grunt", 22, 28}, {"w3-4", "grunt", 28, 28}, {"w3-5", "brute", 16, 30}},
		{{"w4-1", "boss", 16, 30}, {"w4-2", "grunt", 6, 28}, {"w4-3", "grunt", 26, 28}},
	},
}

var saltpanLoop = &gameMap{
	id: "saltpan-loop", width: 200, depth: 120,
	blocks:      []block{{60, 40, 80, 40}},
	spawns:      []spawnPoint{{1, 20, 8, 0}, {2, 20, 14, 0}, {3, 14, 8, 0}, {4, 14, 14, 0}},
	checkpoints: []checkpoint{{"C1", 100, 12}, {"C2", 180, 60}, {"C3", 100, 108}, {"C4", 20, 60}, {"C0", 24, 11}},
}

func mapByID(id string) (*gameMap, bool) {
	switch id {
	case breakwaterYard.id:
		return breakwaterYard, true
	case saltpanLoop.id:
		return saltpanLoop, true
	}
	return nil, false
}

func (m *gameMap) spawn(seat int) spawnPoint { return m.spawns[seat-1] }

// solidAt reports whether the point lies inside a solid block cell.
func (m *gameMap) solidAt(x, z float64) bool {
	for _, b := range m.blocks {
		if x >= float64(b.x) && x < float64(b.x+b.w) && z >= float64(b.z) && z < float64(b.z+b.d) {
			return true
		}
	}
	return false
}

func (m *gameMap) inside(x, z float64) bool { return x >= 0 && x <= m.width && z >= 0 && z <= m.depth }

const sampleStep = 0.02

// segmentBlocked reports whether the straight segment passes through a solid block cell.
func (m *gameMap) segmentBlocked(ax, az, bx, bz float64) bool {
	return m.firstBlock(ax, az, bx, bz) >= 0
}

// firstBlock is the distance along the segment at which it first enters a solid cell, or -1.
func (m *gameMap) firstBlock(ax, az, bx, bz float64) float64 {
	length := math.Hypot(bx-ax, bz-az)
	steps := int(length / sampleStep)
	for i := 0; i <= steps; i++ {
		t := float64(i) * sampleStep
		f := 0.0
		if length > 0 {
			f = t / length
		}
		if m.solidAt(ax+(bx-ax)*f, az+(bz-az)*f) {
			return t
		}
	}
	if m.solidAt(bx, bz) {
		return length
	}
	return -1
}

func (s *server) getMap(w http.ResponseWriter, r *http.Request) error {
	m, ok := mapByID(r.PathValue("id"))
	if !ok {
		return fail("not_found")
	}
	blocks := make([]map[string]any, 0, len(m.blocks))
	for _, b := range m.blocks {
		blocks = append(blocks, map[string]any{"x": b.x, "z": b.z, "w": b.w, "d": b.d})
	}
	spawns := make([]map[string]any, 0, len(m.spawns))
	for _, sp := range m.spawns {
		key := "aim"
		if m.checkpoints != nil {
			key = "heading"
		}
		spawns = append(spawns, map[string]any{"seat": sp.seat, "x": sp.x, "z": sp.z, key: sp.heading})
	}
	barrels := make([]map[string]any, 0, len(m.barrels))
	for _, b := range m.barrels {
		barrels = append(barrels, map[string]any{"id": b.id, "x": b.x, "z": b.z})
	}
	waves := make([]map[string]any, 0, len(m.waves))
	for i, wave := range m.waves {
		enemies := make([]map[string]any, 0, len(wave))
		for _, e := range wave {
			enemies = append(enemies, map[string]any{"id": e.id, "kind": e.kind, "x": e.x, "z": e.z})
		}
		waves = append(waves, map[string]any{"wave": i + 1, "enemies": enemies})
	}
	checkpoints := make([]map[string]any, 0, len(m.checkpoints))
	for _, c := range m.checkpoints {
		checkpoints = append(checkpoints, map[string]any{"id": c.id, "x": c.x, "z": c.z})
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": m.id, "width": m.width, "depth": m.depth, "blocks": blocks,
		"spawns": spawns, "barrels": barrels, "waves": waves, "checkpoints": checkpoints})
	return nil
}
