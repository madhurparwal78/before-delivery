package main

import (
	"fmt"
	"net/mail"
	"os"
	"strconv"
	"strings"
	"time"
)

type config struct {
	DatabaseURL      string
	KeycloakURL      string
	KeycloakRealm    string
	IssuerURL        string
	ClientID         string
	ClientSecret     string
	WiremockURL      string
	SMTPHost         string
	SMTPPort         string
	MailFrom         *mail.Address
	NtfyURL          string
	NtfyUsername     string
	NtfyPassword     string
	Port             string
	PublicURL        string
	HoldSeconds      int
	MatchCutoffSecs  int
	FreeCancelSecs   int
	ShareSettleSecs  int
	AuthRefreshSecs  int
	NoShowGraceSecs  int
	SlotStepMinutes  int
	OpenMinute       int
	CloseMinute      int
	OpeningHours     string
	Location         *time.Location
	NoticeRetryDelay []int
}

func envOr(name, def string) string {
	if v, ok := os.LookupEnv(name); ok && v != "" {
		return v
	}
	return def
}

func envInt(name string, def int) (int, error) {
	v := envOr(name, "")
	if v == "" {
		return def, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return 0, fmt.Errorf("%s must be a positive whole number", name)
	}
	return n, nil
}

func parseClock(s string) (int, error) {
	parts := strings.Split(s, ":")
	if len(parts) != 2 || len(parts[0]) != 2 || len(parts[1]) != 2 {
		return 0, fmt.Errorf("bad clock time %q", s)
	}
	h, err1 := strconv.Atoi(parts[0])
	m, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil || h < 0 || h > 24 || m < 0 || m > 59 || (h == 24 && m != 0) {
		return 0, fmt.Errorf("bad clock time %q", s)
	}
	return h*60 + m, nil
}

func loadConfig() (*config, error) {
	c := &config{
		DatabaseURL:   os.Getenv("DATABASE_URL"),
		KeycloakURL:   strings.TrimRight(os.Getenv("KEYCLOAK_URL"), "/"),
		KeycloakRealm: os.Getenv("KEYCLOAK_REALM"),
		IssuerURL:     strings.TrimRight(os.Getenv("AUTH_ISSUER_URL"), "/"),
		ClientID:      os.Getenv("AUTH_CLIENT_ID"),
		ClientSecret:  os.Getenv("AUTH_CLIENT_SECRET"),
		WiremockURL:   strings.TrimRight(os.Getenv("WIREMOCK_URL"), "/"),
		SMTPHost:      os.Getenv("SMTP_HOST"),
		SMTPPort:      os.Getenv("SMTP_PORT"),
		NtfyURL:       strings.TrimRight(os.Getenv("NTFY_URL"), "/"),
		NtfyUsername:  os.Getenv("NTFY_USERNAME"),
		NtfyPassword:  os.Getenv("NTFY_PASSWORD"),
		Port:          envOr("APP_PUBLIC_PORT", "4173"),
		PublicURL:     strings.TrimRight(os.Getenv("APP_PUBLIC_URL"), "/"),
	}
	for name, v := range map[string]string{
		"DATABASE_URL": c.DatabaseURL, "KEYCLOAK_URL": c.KeycloakURL, "KEYCLOAK_REALM": c.KeycloakRealm,
		"AUTH_ISSUER_URL": c.IssuerURL, "AUTH_CLIENT_ID": c.ClientID, "AUTH_CLIENT_SECRET": c.ClientSecret,
		"WIREMOCK_URL": c.WiremockURL, "SMTP_HOST": c.SMTPHost, "SMTP_PORT": c.SMTPPort, "NTFY_URL": c.NtfyURL,
		"APP_PUBLIC_URL": c.PublicURL,
	} {
		if v == "" {
			return nil, fmt.Errorf("%s is not set", name)
		}
	}
	from, err := mail.ParseAddress(envOr("MAIL_FROM", "Marlowe Yard Padel Club <desk@marloweyard.test>"))
	if err != nil {
		return nil, fmt.Errorf("MAIL_FROM: %w", err)
	}
	c.MailFrom = from
	ints := []struct {
		name string
		def  int
		dst  *int
	}{
		{"HOLD_SECONDS", 600, &c.HoldSeconds},
		{"MATCH_CUTOFF_SECONDS", 7200, &c.MatchCutoffSecs},
		{"FREE_CANCEL_SECONDS", 86400, &c.FreeCancelSecs},
		{"SHARE_SETTLE_SECONDS", 21600, &c.ShareSettleSecs},
		{"AUTH_REFRESH_SECONDS", 518400, &c.AuthRefreshSecs},
		{"NO_SHOW_GRACE_SECONDS", 900, &c.NoShowGraceSecs},
		{"SLOT_STEP_MINUTES", 30, &c.SlotStepMinutes},
	}
	for _, i := range ints {
		if *i.dst, err = envInt(i.name, i.def); err != nil {
			return nil, err
		}
	}
	c.OpeningHours = envOr("OPENING_HOURS", "08:00-23:00")
	open, closeAt, ok := strings.Cut(c.OpeningHours, "-")
	if !ok {
		return nil, fmt.Errorf("OPENING_HOURS must look like 08:00-23:00")
	}
	if c.OpenMinute, err = parseClock(open); err != nil {
		return nil, fmt.Errorf("OPENING_HOURS: %w", err)
	}
	if c.CloseMinute, err = parseClock(closeAt); err != nil {
		return nil, fmt.Errorf("OPENING_HOURS: %w", err)
	}
	if c.OpenMinute >= c.CloseMinute {
		return nil, fmt.Errorf("OPENING_HOURS must open before it closes")
	}
	if c.Location, err = time.LoadLocation(envOr("CLUB_TIMEZONE", "Europe/Madrid")); err != nil {
		return nil, fmt.Errorf("CLUB_TIMEZONE: %w", err)
	}
	for _, p := range strings.Split(envOr("NOTICE_RETRY_SECONDS", "30,120,600,3600"), ",") {
		n, err := strconv.Atoi(strings.TrimSpace(p))
		if err != nil || n < 0 {
			return nil, fmt.Errorf("NOTICE_RETRY_SECONDS must be a list of whole seconds")
		}
		c.NoticeRetryDelay = append(c.NoticeRetryDelay, n)
	}
	return c, nil
}
