package sim

import (
	"testing"
	"time"

	"github.com/cinderlatch/holdfast/internal/clockx"
	"github.com/cinderlatch/holdfast/internal/pricing"
)

// testConvoyRoom builds a convoy room racing with one seated player.
func testConvoyRoom(t *testing.T) *Room {
	t.Helper()
	zone, err := clockx.LoadZone("America/Chicago")
	if err != nil {
		t.Fatalf("load zone: %v", err)
	}
	room := newRoom("TESTCV", "convoy", nil, clockx.New(zone), pricing.NewCache(nil))
	room.hostID = "p1"
	room.seatPlayer(1, "p1", "Jex")
	room.seats[0].Ready = true
	if _, err := room.Start("p1"); err != nil {
		t.Fatalf("start: %v", err)
	}
	for i := int64(0); i <= CountdownMS/tickMS; i++ {
		room.tickHolding("p1")
	}
	if room.phase != PhaseRace {
		t.Fatalf("phase = %q, want race", room.phase)
	}
	return room
}

func TestVehicleStartsAtItsSeatPosition(t *testing.T) {
	room := testConvoyRoom(t)
	vehicle := room.vehicles["p1"]
	if vehicle.X != 20 || vehicle.Z != 8 || vehicle.Heading != 0 {
		t.Errorf("vehicle at %.1f,%.1f heading %.1f, want 20,8 heading 0", vehicle.X, vehicle.Z, vehicle.Heading)
	}
	if vehicle.NextCheckpoint != 1 || vehicle.LapsDone != 0 {
		t.Errorf("next checkpoint %d laps %d, want 1 and 0", vehicle.NextCheckpoint, vehicle.LapsDone)
	}
	if vehicle.State != VehicleRunning {
		t.Errorf("state = %q, want running", vehicle.State)
	}
}

func TestPoseRejectsStaleSequenceAndLeavesTheVehicle(t *testing.T) {
	room := testConvoyRoom(t)
	vehicle := room.vehicles["p1"]
	vehicle.lastPoseAt = time.Now().Add(-time.Second)

	if result := room.pose(room.seats[0], 5, 21, 8, 0); !result.Accepted {
		t.Fatalf("first pose refused: %v", *result.Reason)
	}
	before := *vehicle

	result := room.pose(room.seats[0], 5, 25, 8, 0)
	if result.Accepted || *result.Reason != ReasonStaleSeq {
		t.Errorf("a repeated seq = %v %v, want stale_seq", result.Accepted, result.Reason)
	}
	if vehicle.X != before.X || vehicle.Z != before.Z {
		t.Error("a refused pose moved the vehicle")
	}
}

func TestPoseSpeedCheckAcceptsTheLimitAndRefusesBeyond(t *testing.T) {
	room := testConvoyRoom(t)
	vehicle := room.vehicles["p1"]

	// Pretend a whole second of server time has passed since the last pose.
	vehicle.lastPoseAt = time.Now().Add(-time.Second)
	startX := vehicle.X

	// Exactly at the limit of 30 m plus the half-metre tolerance is accepted.
	result := room.pose(room.seats[0], 1, startX+VehicleTopSpeed+PoseTolerance, vehicle.Z, 0)
	if !result.Accepted {
		t.Fatalf("a pose at the limit was refused: %v", *result.Reason)
	}

	vehicle.lastPoseAt = time.Now().Add(-time.Second)
	held := vehicle.X
	result = room.pose(room.seats[0], 2, held+VehicleTopSpeed+PoseTolerance+0.2, vehicle.Z, 0)
	if result.Accepted || *result.Reason != ReasonTooFast {
		t.Errorf("a pose beyond the limit = %v %v, want too_fast", result.Accepted, result.Reason)
	}
	if vehicle.X != held {
		t.Errorf("a refused pose moved the vehicle to %.2f", vehicle.X)
	}
}

func TestPoseIntoTheIslandWrecksAndResetsAtTheLastCheckpoint(t *testing.T) {
	room := testConvoyRoom(t)
	vehicle := room.vehicles["p1"]
	seat := room.seats[0]

	// Reach checkpoint 1 at (100, 12).
	vehicle.X, vehicle.Z = 100, 12
	room.checkCheckpoint(seat, vehicle, time.Now())
	if vehicle.lastCheckpoint != 1 || vehicle.NextCheckpoint != 2 {
		t.Fatalf("after C1: last %d next %d, want 1 and 2", vehicle.lastCheckpoint, vehicle.NextCheckpoint)
	}

	// Drive into the island, which covers x 60 to 140 and z 40 to 80, within one
	// second of travel at top speed.
	vehicle.lastPoseAt = time.Now().Add(-time.Second)
	result := room.pose(seat, 10, 100, 41, 90)
	if !result.Accepted {
		t.Fatalf("the wrecking pose should still be accepted: %v", *result.Reason)
	}
	if vehicle.State != VehicleWrecked {
		t.Fatalf("state = %q, want wrecked", vehicle.State)
	}
	if vehicle.X != 100 || vehicle.Z != 12 {
		t.Errorf("the vehicle moved to %.1f,%.1f, want its previous 100,12", vehicle.X, vehicle.Z)
	}
	if vehicle.ResetRemainingMS != VehicleResetMS {
		t.Errorf("reset timer = %d, want %d", vehicle.ResetRemainingMS, VehicleResetMS)
	}

	// A pose while wrecked is refused.
	if result := room.pose(seat, 11, 101, 12, 0); result.Accepted || *result.Reason != ReasonWrecked {
		t.Errorf("a pose while wrecked = %v %v, want wrecked", result.Accepted, result.Reason)
	}

	// After the reset delay it stands at C1 facing C2.
	for i := int64(0); i < VehicleResetMS/tickMS; i++ {
		room.tickHolding("p1")
	}
	if vehicle.State != VehicleRunning {
		t.Fatalf("state = %q, want running again", vehicle.State)
	}
	if vehicle.X != 100 || vehicle.Z != 12 {
		t.Errorf("reset to %.1f,%.1f, want C1 at 100,12", vehicle.X, vehicle.Z)
	}
	if want := headingTowards(100, 12, 180, 60); vehicle.Heading != want {
		t.Errorf("heading = %.2f, want %.2f facing C2", vehicle.Heading, want)
	}
}

func TestCheckpointsPassOnlyInOrderAndLapsTime(t *testing.T) {
	room := testConvoyRoom(t)
	vehicle := room.vehicles["p1"]
	seat := room.seats[0]

	// Standing on C3 while C1 is next passes nothing.
	vehicle.X, vehicle.Z = 100, 108
	room.checkCheckpoint(seat, vehicle, time.Now())
	if vehicle.NextCheckpoint != 1 {
		t.Fatalf("next checkpoint = %d, want 1 still", vehicle.NextCheckpoint)
	}

	order := []struct {
		x, z     float64
		wantNext int
	}{
		{100, 12, 2},
		{180, 60, 3},
		{100, 108, 4},
		{20, 60, StartFinishIndex},
	}
	for _, step := range order {
		vehicle.X, vehicle.Z = step.x, step.z
		room.checkCheckpoint(seat, vehicle, time.Now())
		if vehicle.NextCheckpoint != step.wantNext {
			t.Fatalf("at %.0f,%.0f next = %d, want %d", step.x, step.z, vehicle.NextCheckpoint, step.wantNext)
		}
	}

	// Crossing the start/finish line completes a lap on the server's clock.
	vehicle.lapStart = time.Now().Add(-90 * time.Second)
	vehicle.X, vehicle.Z = 24, 11
	room.checkCheckpoint(seat, vehicle, time.Now())
	if vehicle.LapsDone != 1 {
		t.Fatalf("laps done = %d, want 1", vehicle.LapsDone)
	}
	if len(room.laps) != 1 {
		t.Fatalf("stored laps = %d, want 1", len(room.laps))
	}
	if room.laps[0].LapMS < 89_000 || room.laps[0].LapMS > 91_000 {
		t.Errorf("lap time = %d ms, want about 90000", room.laps[0].LapMS)
	}
	if vehicle.BestLapMS != room.laps[0].LapMS {
		t.Errorf("best lap = %d, want %d", vehicle.BestLapMS, room.laps[0].LapMS)
	}
	if vehicle.NextCheckpoint != 1 || vehicle.lastCheckpoint != -1 {
		t.Errorf("the next lap starts at C1, got next %d last %d", vehicle.NextCheckpoint, vehicle.lastCheckpoint)
	}

	// Three laps finish the vehicle, and a later pose is refused.
	for lap := 2; lap <= LapsToFinish; lap++ {
		vehicle.lastCheckpoint = LastCheckpointIdx
		vehicle.NextCheckpoint = StartFinishIndex
		vehicle.X, vehicle.Z = 24, 11
		room.checkCheckpoint(seat, vehicle, time.Now())
	}
	if vehicle.State != VehicleFinished || vehicle.LapsDone != LapsToFinish {
		t.Fatalf("state %q laps %d, want finished and %d", vehicle.State, vehicle.LapsDone, LapsToFinish)
	}
	if result := room.pose(seat, 99, 25, 11, 0); result.Accepted || *result.Reason != ReasonFinished {
		t.Errorf("a pose once finished = %v %v, want finished", result.Accepted, result.Reason)
	}

	// With every racer finished the race ends.
	room.tickHolding("p1")
	if room.phase != PhaseOver || room.result != ResultFinished {
		t.Errorf("phase %q result %q, want over finished", room.phase, room.result)
	}
}

func TestPoseOutsideTheMapWrecks(t *testing.T) {
	room := testConvoyRoom(t)
	vehicle := room.vehicles["p1"]
	vehicle.lastPoseAt = time.Now().Add(-time.Second)

	result := room.pose(room.seats[0], 1, -5, 8, 180)
	if !result.Accepted || vehicle.State != VehicleWrecked {
		t.Errorf("a pose off the map = accepted %v state %q, want true wrecked", result.Accepted, vehicle.State)
	}
}
