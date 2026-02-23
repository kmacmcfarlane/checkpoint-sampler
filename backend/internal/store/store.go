package store

import (
	"database/sql"

	"github.com/sirupsen/logrus"
)

// Store provides access to the persistence layer.
type Store struct {
	db     *sql.DB
	logger *logrus.Entry
}

// New creates a Store backed by the given database and runs all pending
// migrations. The caller should call Close when the store is no longer needed.
func New(db *sql.DB, logger *logrus.Logger) (*Store, error) {
	entry := logger.WithField("component", "store")
	entry.Trace("entering New")
	defer entry.Trace("returning from New")

	if err := Migrate(db, AllMigrations()); err != nil {
		entry.WithError(err).Error("database migration failed")
		return nil, err
	}
	entry.Info("database migrations completed")
	return &Store{
		db:     db,
		logger: entry,
	}, nil
}

// Close closes the underlying database connection.
func (s *Store) Close() error {
	return s.db.Close()
}

// DB returns the underlying database connection for use in queries.
func (s *Store) DB() *sql.DB {
	return s.db
}
