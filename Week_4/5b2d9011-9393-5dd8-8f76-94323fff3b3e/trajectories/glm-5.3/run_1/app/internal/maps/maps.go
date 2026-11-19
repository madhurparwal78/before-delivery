// Package maps holds the two published maps exactly as specified in the seed
// data, and the geometry helpers the simulation shares.
package maps

// Block is a solid block cell on a siege map, named by its south-west corner.
type Block struct {
	X int `json:"x"`
	Z int `json:"z"`
	W int `json:"w"`
	D int `json:"d"`
}

// Spawn is a seat's spawn point.
type Spawn struct {
	Seat int     `json:"seat"`
	X    float64 `json:"x"`
	Z    float64 `json:"z"`
	Aim  float64 `json:"aim"`
}

// BarrelSeed is one barrel's spawn.
type BarrelSeed struct {
	ID string  `json:"id"`
	X  float64 `json:"x"`
	Z  float64 `json:"z"`
}

// WaveEnemy is one enemy of a wave.
type WaveEnemy struct {
	ID     string  `json:"id"`
	Kind   string  `json:"kind"`
	X      float64 `json:"x"`
	Z      float64 `json:"z"`
}

// Wave is one wave's spawn list.
type Wave struct {
	Kind    string      `json:"kind"`
	Enemies []WaveEnemy `json:"enemies"`
}

// Checkpoint is a convoy checkpoint.
type Checkpoint struct {
	ID string  `json:"id"`
	X  float64 `json:"x"`
	Z  float64 `json:"z"`
}

// Map is a published map.
type Map struct {
	ID          string        `json:"id"`
	Width       float64       `json:"width"`
	Depth       float64       `json:"depth"`
	Blocks      []Block       `json:"blocks"`
	Spawns      []Spawn       `json:"spawns"`
	Barrels     []BarrelSeed  `json:"barrels"`
	Waves       []Wave        `json:"waves"`
	Checkpoints []Checkpoint  `json:"checkpoints"`
	Starts      []VehicleStart `json:"starts"`
}

// VehicleStart is a seat's convoy start position and heading.
type VehicleStart struct {
	Seat    int     `json:"seat"`
	X       float64 `json:"x"`
	Z       float64 `json:"z"`
	Heading float64 `json:"heading"`
}

// BreakwaterYard is the siege map.
var BreakwaterYard = Map{
	ID:     "breakwater-yard",
	Width:  32,
	Depth:  32,
	Blocks: []Block{
		// West seawall
		{X: 8, Z: 14, W: 1, D: 1}, {X: 9, Z: 14, W: 1, D: 1}, {X: 10, Z: 14, W: 1, D: 1}, {X: 11, Z: 14, W: 1, D: 1},
		// East seawall
		{X: 20, Z: 14, W: 1, D: 1}, {X: 21, Z: 14, W: 1, D: 1}, {X: 22, Z: 14, W: 1, D: 1}, {X: 23, Z: 14, W: 1, D: 1},
		// Crate stack
		{X: 15, Z: 22, W: 1, D: 1}, {X: 16, Z: 22, W: 1, D: 1}, {X: 15, Z: 23, W: 1, D: 1}, {X: 16, Z: 23, W: 1, D: 1},
		// Pillars
		{X: 4, Z: 8, W: 1, D: 1}, {X: 27, Z: 8, W: 1, D: 1},
	},
	Spawns: []Spawn{
		{Seat: 1, X: 16.0, Z: 4.0, Aim: 90},
		{Seat: 2, X: 14.0, Z: 4.0, Aim: 90},
		{Seat: 3, X: 18.0, Z: 4.0, Aim: 90},
		{Seat: 4, X: 16.0, Z: 6.0, Aim: 90},
	},
	Barrels: []BarrelSeed{
		{ID: "B1", X: 6.5, Z: 20.5},
		{ID: "B2", X: 8.0, Z: 20.5},
		{ID: "B3", X: 25.5, Z: 20.5},
		{ID: "B4", X: 16.0, Z: 25.0},
	},
	Waves: []Wave{
		{Kind: "wave", Enemies: []WaveEnemy{
			{ID: "w1-1", Kind: "grunt", X: 10, Z: 28},
			{ID: "w1-2", Kind: "grunt", X: 16, Z: 28},
			{ID: "w1-3", Kind: "grunt", X: 22, Z: 28},
		}},
		{Kind: "wave", Enemies: []WaveEnemy{
			{ID: "w2-1", Kind: "grunt", X: 4, Z: 28},
			{ID: "w2-2", Kind: "grunt", X: 10, Z: 28},
			{ID: "w2-3", Kind: "grunt", X: 16, Z: 30},
			{ID: "w2-4", Kind: "grunt", X: 22, Z: 28},
			{ID: "w2-5", Kind: "grunt", X: 28, Z: 28},
		}},
		{Kind: "wave", Enemies: []WaveEnemy{
			{ID: "w3-1", Kind: "grunt", X: 4, Z: 28},
			{ID: "w3-2", Kind: "grunt", X: 10, Z: 28},
			{ID: "w3-3", Kind: "grunt", X: 22, Z: 28},
			{ID: "w3-4", Kind: "grunt", X: 28, Z: 28},
			{ID: "w3-5", Kind: "brute", X: 16, Z: 30},
		}},
		{Kind: "boss_wave", Enemies: []WaveEnemy{
			{ID: "w4-1", Kind: "boss", X: 16, Z: 30},
			{ID: "w4-2", Kind: "grunt", X: 6, Z: 28},
			{ID: "w4-3", Kind: "grunt", X: 26, Z: 28},
		}},
	},
}

// SaltpanLoop is the convoy map.
var SaltpanLoop = Map{
	ID:     "saltpan-loop",
	Width:  200,
	Depth:  120,
	Blocks: []Block{
		// Solid island: x 60 to 140, z 40 to 80.
		{X: 60, Z: 40, W: 80, D: 40},
	},
	Starts: []VehicleStart{
		{Seat: 1, X: 20, Z: 8, Heading: 0},
		{Seat: 2, X: 20, Z: 14, Heading: 0},
		{Seat: 3, X: 14, Z: 8, Heading: 0},
		{Seat: 4, X: 14, Z: 14, Heading: 0},
	},
	Checkpoints: []Checkpoint{
		{ID: "C1", X: 100, Z: 12},
		{ID: "C2", X: 180, Z: 60},
		{ID: "C3", X: 100, Z: 108},
		{ID: "C4", X: 20, Z: 60},
		{ID: "C0", X: 24, Z: 11},
	},
}

// ByID returns a map by id.
func ByID(id string) (Map, bool) {
	switch id {
	case BreakwaterYard.ID:
		return BreakwaterYard, true
	case SaltpanLoop.ID:
		return SaltpanLoop, true
	}
	return Map{}, false
}

// SiegeMapID is the siege map's id; rooms of mode siege use it.
const SiegeMapID = "breakwater-yard"

// ConvoyMapID is the convoy map's id.
const ConvoyMapID = "saltpan-loop"
