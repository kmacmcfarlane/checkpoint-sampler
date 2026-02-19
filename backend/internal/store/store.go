package store

import (
	"database/sql"
)

// Store provides access to the persistence layer.
type Store struct {
	db *sql.DB
}

// New creates a Store backed by the given database and runs all pending
// migrations. The caller should call Close when the store is no longer needed.
func New(db *sql.DB) (*Store, error) {
	if err := Migrate(db, AllMigrations()); err != nil {
		return nil, err
	}
	return &Store{db: db}, nil
}

// Close closes the underlying database connection.
func (s *Store) Close() error {
	return s.db.Close()
}

// DB returns the underlying database connection for use in queries.
func (s *Store) DB() *sql.DB {
	return s.db
}
