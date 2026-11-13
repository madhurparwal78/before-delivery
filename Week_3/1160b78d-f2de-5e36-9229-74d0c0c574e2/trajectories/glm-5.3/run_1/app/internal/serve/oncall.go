package serve

import (
	"context"
	"net/http"
	"sort"
	"time"

	"switchlamp/internal/domain"
	"switchlamp/internal/store"
)

// policySnapshotFor copies a service's policy as it stands now.
func (s *Server) policySnapshotFor(ctx context.Context, sv *store.ServiceRecord) (domain.PolicySnapshot, error) {
	if sv.PolicyID == nil {
		return domain.PolicySnapshot{Name: "No policy", Version: 1}, nil
	}
	p, err := s.store.Policy(ctx, *sv.PolicyID)
	if err != nil {
		return domain.PolicySnapshot{Name: "No policy", Version: 1}, nil
	}
	return domain.PolicySnapshot{Name: p.Name, Version: p.Version, Repeats: p.Repeats, Levels: p.Levels}, nil
}

// levelHoldersFor resolves a level's targets at an instant.
func (s *Server) levelHoldersFor(ctx context.Context, level domain.PolicyLevel, at time.Time) ([]domain.Holder, bool, error) {
	names, err := s.store.UserNames(ctx)
	if err != nil {
		return nil, false, err
	}
	seen := map[string]bool{}
	var out []domain.Holder
	for _, t := range level.Targets {
		if t.Type == "person" {
			if name, ok := names[t.ID]; ok && !seen[t.ID] {
				out = append(out, domain.Holder{ID: t.ID, Name: name})
				seen[t.ID] = true
			}
			continue
		}
		holder, err := s.scheduleHolderFor(ctx, t.ID, at)
		if err != nil {
			return nil, false, err
		}
		if holder != nil && !seen[holder.ID] {
			out = append(out, *holder)
			seen[holder.ID] = true
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, len(out) == 0, nil
}

// scheduleHolderFor resolves who is on call for a schedule at an instant.
func (s *Server) scheduleHolderFor(ctx context.Context, scheduleID string, at time.Time) (*domain.Holder, error) {
	sc, err := s.store.Schedule(ctx, scheduleID)
	if err != nil {
		return nil, nil
	}
	names, err := s.store.UserNames(ctx)
	if err != nil {
		return nil, err
	}
	layers, err := s.store.Layers(ctx, scheduleID)
	if err != nil {
		return nil, err
	}
	for _, l := range layers {
		l.SetScheduleZone(sc.Zone)
		l.RecordFormat = sc.RecordFormat
	}
	overrides, err := s.store.Overrides(ctx, scheduleID)
	if err != nil {
		return nil, err
	}
	blocks := domain.FinalSchedule(layers, overrides, at, at.Add(time.Second), names)
	if len(blocks) == 0 {
		return nil, nil
	}
	return blocks[0].Person, nil
}

// handleOncall serves who-is-on-call with a cached copy and ETag.
func (s *Server) handleOncall(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	ctx := r.Context()
	schedules, err := s.store.Schedules(ctx)
	if err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	scheduleID := r.URL.Query().Get("schedule_id")
	var chosen *store.ScheduleRecord
	for _, sc := range schedules {
		if sc.ID == scheduleID || (scheduleID == "" && chosen == nil) {
			chosen = sc
		}
	}
	if scheduleID != "" && (chosen == nil || chosen.ID != scheduleID) {
		apiError(w, http.StatusNotFound, "not_found")
		return
	}
	if chosen == nil && len(schedules) > 0 {
		chosen = schedules[0]
	}
	now := s.engine.Now()
	body := s.buildOncall(ctx, chosen, now)
	etag := `"` + oncallETag(body) + `"`
	cacheState := "miss"
	if s.cache.Up(ctx) {
		if _, cached, ok := s.cache.Get(ctx, "cache:oncall:"+chosen.ID); ok && cached != "" {
			var m map[string]any
			if jsonUnmarshal(cached, &m) == nil {
				// The cached copy is served only inside its until second.
				if until, ok := m["until"].(string); !ok || until == "" || until >= now.UTC().Format(time.RFC3339) {
					w.Header().Set("X-Switchlamp-Cache", "hit")
					w.Header().Set("ETag", etag)
					if match := r.Header.Get("If-None-Match"); match == etag {
						w.WriteHeader(http.StatusNotModified)
						return
					}
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusOK)
					w.Write([]byte(cached))
					return
				}
			}
		}
		if err := s.cache.Set(ctx, "cache:oncall:"+chosen.ID, etag, string(mustJSON(body))); err == nil {
			cacheState = "miss"
		}
	} else {
		cacheState = "bypass"
	}
	w.Header().Set("X-Switchlamp-Cache", cacheState)
	w.Header().Set("ETag", etag)
	if match := r.Header.Get("If-None-Match"); match == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	writeJSON(w, http.StatusOK, body)
}

func (s *Server) buildOncall(ctx context.Context, sc *store.ScheduleRecord, now time.Time) map[string]any {
	holder, _ := s.scheduleHolderFor(ctx, sc.ID, now)
	until := (*string)(nil)
	// The handoff second follows the final schedule's next block edge.
	names, _ := s.store.UserNames(ctx)
	layers, _ := s.store.Layers(ctx, sc.ID)
	for _, l := range layers {
		l.SetScheduleZone(sc.Zone)
		l.RecordFormat = sc.RecordFormat
	}
	overrides, _ := s.store.Overrides(ctx, sc.ID)
	blocks := domain.FinalSchedule(layers, overrides, now, now.Add(7*24*time.Hour), names)
	for _, b := range blocks {
		if b.Start.After(now) {
			u := b.Start.UTC().Format(time.RFC3339)
			until = &u
			break
		}
	}
	return map[string]any{
		"schedule": map[string]string{"id": sc.ID, "name": sc.Name},
		"at":       now.UTC().Format(time.RFC3339),
		"holder":   holder,
		"gap":      holder == nil,
		"until":    until,
	}
}

func oncallETag(body map[string]any) string {
	holder, _ := body["holder"].(map[string]any)
	name := "nobody"
	if id, ok := holder["id"].(string); ok {
		name = id
	}
	until, _ := body["until"].(string)
	if until == "" {
		until = "none"
	}
	return name + "-" + until
}
