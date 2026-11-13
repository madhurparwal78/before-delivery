package main

var levelLabels = map[string]string{"free_busy": "See only free/busy", "details": "See all details", "edit": "Make changes", "manage": "Manage sharing"}

func (s *Server) registerSharingRoutes() {
	s.route("GET /api/shares", false, s.handleShares)
	s.route("PUT /api/calendars/{id}/shares/{person}", false, s.handlePutShare)
	s.route("DELETE /api/calendars/{id}/shares/{person}", false, s.handleDeleteShare)
}

// shareAuthority loads a calendar and checks the caller may read or change its shares.
func (rq *Req) shareAuthority(calendarID string) (*World, *Calendar, error) {
	w, err := rq.World()
	if err != nil {
		return nil, nil, err
	}
	c := w.Calendars[calendarID]
	if c == nil {
		return nil, nil, errNotFound
	}
	if c.ID == holidaysCalendar || (rq.Me.Role != "office_manager" && !w.canManage(c, rq.Me)) {
		return nil, nil, errForbidden
	}
	return w, c, nil
}

func (s *Server) handleShares(rq *Req) error {
	id := rq.R.URL.Query().Get("calendar_id")
	if id == "" {
		return fieldErr("calendar_id", "Choose a calendar.")
	}
	w, c, err := rq.shareAuthority(id)
	if err != nil {
		return err
	}
	shares := []map[string]any{}
	for _, p := range w.peopleSorted() {
		if level, ok := w.Shares[c.ID][p.ID]; ok {
			shares = append(shares, map[string]any{"person_id": p.ID, "name": p.Name, "level": level})
		}
	}
	return rq.json(200, map[string]any{"shares": shares})
}

func (s *Server) handlePutShare(rq *Req) error {
	var body struct {
		Level string `json:"level"`
	}
	w, c, err := rq.shareAuthority(rq.R.PathValue("id"))
	if err != nil {
		return err
	}
	if err := rq.decode(&body); err != nil {
		return err
	}
	person := w.People[rq.R.PathValue("person")]
	if person == nil {
		return errNotFound
	}
	if _, ok := levelLabels[body.Level]; !ok {
		return fieldErr("level", "Choose free_busy, details, edit or manage.")
	}
	if c.OwnerID != nil && *c.OwnerID == person.ID {
		return fieldErr("person", "The owner already has full access.")
	}
	if person.Role == "guest" {
		return fieldErr("person", "Outside guests have no calendar access.")
	}
	err = s.edit(rq.ctx(), rq.Me, func(ed *Edit) error {
		if _, err := ed.Tx.ExecContext(ed.Ctx, `INSERT INTO shares VALUES ($1,$2,$3) ON CONFLICT (calendar_id, person_id) DO UPDATE SET level = $3`,
			c.ID, person.ID, body.Level); err != nil {
			return err
		}
		return ed.shareChanged(c, person.ID, body.Level, "Your access to "+c.Name+" changed to "+levelLabels[body.Level]+".")
	})
	if err != nil {
		return err
	}
	return rq.json(200, map[string]any{"person_id": person.ID, "name": person.Name, "level": body.Level})
}

func (s *Server) handleDeleteShare(rq *Req) error {
	_, c, err := rq.shareAuthority(rq.R.PathValue("id"))
	if err != nil {
		return err
	}
	person := rq.R.PathValue("person")
	err = s.edit(rq.ctx(), rq.Me, func(ed *Edit) error {
		res, err := ed.Tx.ExecContext(ed.Ctx, `DELETE FROM shares WHERE calendar_id=$1 AND person_id=$2`, c.ID, person)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return nil
		}
		return ed.shareChanged(c, person, "", "You no longer have access to "+c.Name+".")
	})
	if err != nil {
		return err
	}
	return rq.noContent()
}

// shareChanged writes the notice and the live message for a changed or removed share level.
func (ed *Edit) shareChanged(c *Calendar, person, level, text string) error {
	nid, err := ed.notice(person, "share", text, "")
	if err != nil {
		return err
	}
	var lv any
	if level != "" {
		lv = level
	}
	return ed.log(ChangeRow{Type: "share.changed", CalendarID: c.ID, PersonID: person,
		Data: map[string]any{"calendar_id": c.ID, "level": lv, "text": text, "notice_id": itoa(nid)}})
}
