package main

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// config holds every environment variable the server reads, once, at start.
type config struct {
	databaseURL  string
	keycloakURL  string
	realm        string
	issuerURL    string
	clientID     string
	clientSecret string
	port         string
	publicURL    string
	lotGap       time.Duration
	softClose    time.Duration
	paymentDue   time.Duration
	offerWindow  time.Duration
	watchNotice  time.Duration
}

func loadConfig() (config, error) {
	c := config{
		databaseURL:  os.Getenv("DATABASE_URL"),
		keycloakURL:  strings.TrimRight(os.Getenv("KEYCLOAK_URL"), "/"),
		realm:        os.Getenv("KEYCLOAK_REALM"),
		issuerURL:    strings.TrimRight(os.Getenv("AUTH_ISSUER_URL"), "/"),
		clientID:     os.Getenv("AUTH_CLIENT_ID"),
		clientSecret: os.Getenv("AUTH_CLIENT_SECRET"),
		port:         os.Getenv("APP_PUBLIC_PORT"),
		publicURL:    strings.TrimRight(os.Getenv("APP_PUBLIC_URL"), "/"),
	}
	if c.port == "" {
		c.port = "4173"
	}
	if c.databaseURL == "" {
		return c, errors.New("DATABASE_URL is not set")
	}
	plain, err := plainConnection(c.databaseURL)
	if err != nil {
		return c, err
	}
	c.databaseURL = plain
	if c.lotGap, err = seconds("LOT_GAP_SECONDS", 60); err != nil {
		return c, err
	}
	if c.softClose, err = seconds("SOFT_CLOSE_SECONDS", 120); err != nil {
		return c, err
	}
	if c.paymentDue, err = seconds("PAYMENT_DUE_SECONDS", 259200); err != nil {
		return c, err
	}
	if c.offerWindow, err = seconds("OFFER_SECONDS", 86400); err != nil {
		return c, err
	}
	if c.watchNotice, err = seconds("WATCH_NOTICE_SECONDS", 300); err != nil {
		return c, err
	}
	return c, nil
}

// plainConnection asks for an unencrypted PostgreSQL connection unless the URL says otherwise.
func plainConnection(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", errors.New("DATABASE_URL is not a valid connection URL")
	}
	q := u.Query()
	if q.Get("sslmode") == "" {
		q.Set("sslmode", "disable")
	}
	u.RawQuery = q.Encode()
	return u.String(), nil
}

func seconds(name string, fallback int) (time.Duration, error) {
	raw := os.Getenv(name)
	if raw == "" {
		return time.Duration(fallback) * time.Second, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 0 {
		return 0, fmt.Errorf("%s must be a whole number of seconds", name)
	}
	return time.Duration(n) * time.Second, nil
}
