package main

import (
	"bytes"
	"fmt"
	"html/template"
	"strings"
)

const (
	slowerNotice      = "Figures are coming straight from the record, so this page may load more slowly."
	noUpdatesSentence = "No updates published."
)

// statusPageData is what the status page template shows.
type statusPageData struct {
	Firm         string
	Headline     string
	Slower       bool
	SlowerNotice string
	Services     []serviceShown
	Banners      []string
	Updates      []pageUpdate
	NoUpdates    string
}

type pageUpdate struct {
	updateShown
	StateLabel     string
	PublishedLocal string
	ServiceList    string
}

// newStatusPageData shapes the public status for the template, with times in the firm's zone.
func newStatusPageData(view statusView) (statusPageData, error) {
	data := statusPageData{Firm: view.Firm, Headline: view.Headline, Slower: view.Slower, SlowerNotice: slowerNotice,
		Services: view.Services, NoUpdates: noUpdatesSentence}
	for _, banner := range view.Maintenance {
		ends, err := parseInstant(banner.EndsAt)
		if err != nil {
			return statusPageData{}, fmt.Errorf("read maintenance end: %w", err)
		}
		local, err := localTime(ends, firmZone)
		if err != nil {
			return statusPageData{}, fmt.Errorf("convert maintenance end to firm time: %w", err)
		}
		data.Banners = append(data.Banners, "Maintenance on "+banner.Service+" until "+local)
	}
	for _, update := range view.Updates {
		published, err := parseInstant(update.PublishedAt)
		if err != nil {
			return statusPageData{}, fmt.Errorf("read update time: %w", err)
		}
		local, err := localTime(published, firmZone)
		if err != nil {
			return statusPageData{}, fmt.Errorf("convert update time to firm time: %w", err)
		}
		data.Updates = append(data.Updates, pageUpdate{updateShown: update, StateLabel: updateStateLabels[update.State],
			PublishedLocal: local, ServiceList: strings.Join(update.Services, ", ")})
	}
	return data, nil
}

// renderStatusPage renders the whole public status page: the yard plate, the firm's name and the status below it.
func (a *App) renderStatusPage(view statusView) ([]byte, error) {
	data, err := newStatusPageData(view)
	if err != nil {
		return nil, fmt.Errorf("build status page data: %w", err)
	}
	var plate, body, page bytes.Buffer
	if err := pageTemplates.ExecuteTemplate(&plate, "status_plate.html", map[string]any{"Plate": view.Plate}); err != nil {
		return nil, fmt.Errorf("render status plate: %w", err)
	}
	if err := pageTemplates.ExecuteTemplate(&body, "status_body.html", data); err != nil {
		return nil, fmt.Errorf("render status body: %w", err)
	}
	boot := bootData{Page: "status", Params: map[string]string{"zone": firmZone}}
	err = pageTemplates.ExecuteTemplate(&page, "entry.html", map[string]any{"Title": view.Firm + " status", "Page": "status",
		"Plate": view.Plate, "PlateHTML": template.HTML(plate.String()), "Body": template.HTML(body.String()),
		"Head": template.HTML(`<link rel="stylesheet" href="/assets/css/status.css">`), "Boot": boot.encode()})
	if err != nil {
		return nil, fmt.Errorf("render status page: %w", err)
	}
	return page.Bytes(), nil
}

func (a *App) hStatusPage(rq *Req) error {
	answer, err := a.cachedStatus(rq.Ctx(), "html", a.renderStatusPage)
	if err != nil {
		return fmt.Errorf("serve status page: %w", err)
	}
	if err := rq.serveStatus(answer, "text/html; charset=utf-8"); err != nil {
		return fmt.Errorf("answer status page request: %w", err)
	}
	return nil
}

func init() {
	routeSetups = append(routeSetups, func(a *App) {
		a.route(route{Pattern: "GET /status", Access: accPublic, Handler: a.hStatusPage})
	})
}
