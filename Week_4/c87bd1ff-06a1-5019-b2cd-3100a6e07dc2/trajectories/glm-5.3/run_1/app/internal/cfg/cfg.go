package cfg

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	DatabaseURL      string
	KeycloakURL      string
	KeycloakRealm    string
	AuthIssuerURL    string
	AuthClientID     string
	AuthClientSecret string
	PublicPort       string
	PublicURL        string
	LotGap           time.Duration
	SoftClose        time.Duration
	PaymentDue       time.Duration
	OfferWindow      time.Duration
	WatchNotice      time.Duration
}

func readDuration(name string, def int) (time.Duration, error) {
	v := os.Getenv(name)
	if v == "" {
		return time.Duration(def) * time.Second, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 0 {
		return 0, fmt.Errorf("%s must be a whole number of seconds", name)
	}
	return time.Duration(n) * time.Second, nil
}

func Load() (Config, error) {
	c := Config{
		DatabaseURL:      os.Getenv("DATABASE_URL"),
		KeycloakURL:      os.Getenv("KEYCLOAK_URL"),
		KeycloakRealm:    os.Getenv("KEYCLOAK_REALM"),
		AuthIssuerURL:    os.Getenv("AUTH_ISSUER_URL"),
		AuthClientID:     os.Getenv("AUTH_CLIENT_ID"),
		AuthClientSecret: os.Getenv("AUTH_CLIENT_SECRET"),
		PublicPort:       os.Getenv("APP_PUBLIC_PORT"),
		PublicURL:        os.Getenv("APP_PUBLIC_URL"),
	}
	if c.PublicPort == "" {
		c.PublicPort = "4173"
	}
	var err error
	if c.LotGap, err = readDuration("LOT_GAP_SECONDS", 60); err != nil {
		return Config{}, err
	}
	if c.SoftClose, err = readDuration("SOFT_CLOSE_SECONDS", 120); err != nil {
		return Config{}, err
	}
	if c.PaymentDue, err = readDuration("PAYMENT_DUE_SECONDS", 259200); err != nil {
		return Config{}, err
	}
	if c.OfferWindow, err = readDuration("OFFER_SECONDS", 86400); err != nil {
		return Config{}, err
	}
	if c.WatchNotice, err = readDuration("WATCH_NOTICE_SECONDS", 300); err != nil {
		return Config{}, err
	}
	if c.DatabaseURL == "" {
		return Config{}, fmt.Errorf("DATABASE_URL is not set")
	}
	if c.AuthIssuerURL == "" {
		return Config{}, fmt.Errorf("AUTH_ISSUER_URL is not set")
	}
	if c.KeycloakURL == "" {
		return Config{}, fmt.Errorf("KEYCLOAK_URL is not set")
	}
	if c.KeycloakRealm == "" {
		return Config{}, fmt.Errorf("KEYCLOAK_REALM is not set")
	}
	return c, nil
}
