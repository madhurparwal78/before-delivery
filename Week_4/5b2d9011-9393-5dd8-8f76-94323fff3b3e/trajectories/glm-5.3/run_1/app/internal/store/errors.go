package store

import (
	"database/sql"
	"errors"
)

// IsNotFound reports whether err is a missing row, in one place.
func IsNotFound(err error) bool {
	return errors.Is(err, sql.ErrNoRows) || errors.Is(err, ErrNotFound)
}
