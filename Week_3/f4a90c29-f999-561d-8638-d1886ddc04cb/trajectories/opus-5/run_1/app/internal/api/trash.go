package api

import (
	"context"
	"net/http"

	"sundialwren/internal/domain"
	"sundialwren/internal/store"
)

func (s *Server) handleTrash(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	items, err := s.Store.TrashItems(r.Context(), c.Now)
	if err != nil {
		s.fail(w, err)
		return
	}
	out := make([]store.TrashItem, 0, len(items))
	for _, item := range items {
		if c.Viewer.CanEditCalendar(item.CalendarID) {
			out = append(out, item)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": out})
}

func (s *Server) handleRestore(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	item, err := s.Store.TrashItem(r.Context(), pathValue(r, "id"), c.Now)
	if err != nil {
		notFound(w)
		return
	}
	if !c.Viewer.CanEditCalendar(item.CalendarID) {
		forbidden(w, "forbidden")
		return
	}
	if item.State != "trashed" {
		if item.State == "purged" {
			notFound(w)
			return
		}
		writeError(w, http.StatusConflict, "not_trashed", "That item is not in the trash.", nil)
		return
	}
	e, err := s.Store.Event(r.Context(), item.EventID)
	if err != nil {
		notFound(w)
		return
	}
	if item.Kind == "occurrence" {
		if e.TrashedAt != nil {
			writeError(w, http.StatusConflict, "parent_trashed", parentTrashedMessage, nil)
			return
		}
		// A restored occurrence returns to whichever series now holds its date.
		holder := s.seriesHolding(r.Context(), e, item.Key)
		if err := s.Store.UndeleteException(r.Context(), holder.ID, item.Key); err != nil {
			s.fail(w, err)
			return
		}
		if err := s.Store.BumpVersion(r.Context(), holder.ID); err != nil {
			s.fail(w, err)
			return
		}
		if err := s.Store.SetTrashState(r.Context(), item.ID, "restored"); err != nil {
			s.fail(w, err)
			return
		}
		fresh, err := s.Store.Event(r.Context(), holder.ID)
		if err != nil {
			s.fail(w, err)
			return
		}
		s.syncReminders(r.Context(), fresh)
		s.publish(r.Context(), changeEvent, changeSpec{EventID: fresh.ID, CalendarID: fresh.CalendarID})
		writeJSON(w, http.StatusOK, map[string]any{"event": c.Projector.Event(fresh, item.Key)})
		return
	}
	if err := s.Store.SetTrashed(r.Context(), e.ID, nil); err != nil {
		s.fail(w, err)
		return
	}
	if err := s.Store.SetTrashState(r.Context(), item.ID, "restored"); err != nil {
		s.fail(w, err)
		return
	}
	if err := s.Store.RestoreReminders(r.Context(), e.ID, c.Now); err != nil {
		s.fail(w, err)
		return
	}
	fresh, err := s.Store.Event(r.Context(), e.ID)
	if err != nil {
		s.fail(w, err)
		return
	}
	s.syncReminders(r.Context(), fresh)
	s.publish(r.Context(), changeEvent, changeSpec{EventID: fresh.ID, CalendarID: fresh.CalendarID})
	writeJSON(w, http.StatusOK, map[string]any{"event": c.Projector.Event(fresh, "")})
}

// seriesHolding finds which series of a split now holds an occurrence's date,
// which is the one carrying its deleted exception.
func (s *Server) seriesHolding(ctx context.Context, e *domain.Event, key string) *domain.Event {
	family, err := s.Store.EventsInSeries(ctx, e.SeriesID)
	if err != nil {
		return e
	}
	for _, candidate := range family {
		if x := candidate.Exception(key); x != nil && x.Deleted {
			return candidate
		}
	}
	return e
}

func (s *Server) handleDeleteForGood(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	item, err := s.Store.TrashItem(r.Context(), pathValue(r, "id"), c.Now)
	if err != nil {
		notFound(w)
		return
	}
	if !c.Viewer.CanEditCalendar(item.CalendarID) {
		forbidden(w, "forbidden")
		return
	}
	if item.State == "purged" {
		notFound(w)
		return
	}
	if item.Kind == "occurrence" {
		if err := s.Store.SetTrashState(r.Context(), item.ID, "purged"); err != nil {
			s.fail(w, err)
			return
		}
	} else if err := s.Store.PurgeEvent(r.Context(), item.EventID); err != nil {
		s.fail(w, err)
		return
	}
	s.publish(r.Context(), changeDeleted, changeSpec{EventID: item.EventID, CalendarID: item.CalendarID})
	writeJSON(w, http.StatusNoContent, nil)
}
