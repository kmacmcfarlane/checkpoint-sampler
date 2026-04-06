package store

import (
	"context"
	"database/sql"
	"fmt"

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

// ResetDB drops all application tables and the schema_migrations tracking
// table, then reruns all migrations from scratch. This gives a clean database
// state identical to a fresh startup. It is intended for test-only use.
//
// The entire operation (drops + migrations) runs inside a single EXCLUSIVE
// transaction so that concurrent callers are serialized at the SQLite level.
// This prevents UNIQUE constraint failures on schema_migrations when multiple
// E2E shards reset in parallel.
func (s *Store) ResetDB() error {
	s.logger.Trace("entering ResetDB")
	defer s.logger.Trace("returning from ResetDB")

	// Pin a single connection so that all statements run on the same SQLite
	// connection, then open an EXCLUSIVE transaction to block all other
	// writers for the duration of the reset. This prevents concurrent
	// ResetDB calls from interleaving DROP/CREATE/INSERT statements.
	conn, err := s.db.Conn(context.Background())
	if err != nil {
		return fmt.Errorf("acquiring connection for reset: %w", err)
	}
	defer conn.Close()

	if _, err := conn.ExecContext(context.Background(), "BEGIN EXCLUSIVE"); err != nil {
		return fmt.Errorf("beginning exclusive transaction for reset: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			conn.ExecContext(context.Background(), "ROLLBACK")
		}
	}()

	ctx := context.Background()

	// Drop tables in reverse dependency order to respect foreign keys.
	tables := []string{
		"sample_job_items",
		"sample_jobs",
		"studies",
		"sample_presets",
		"presets",
		"schema_migrations",
	}
	for _, t := range tables {
		if _, err := conn.ExecContext(ctx, "DROP TABLE IF EXISTS "+t); err != nil {
			s.logger.WithError(err).WithField("table", t).Error("failed to drop table")
			return fmt.Errorf("dropping table %s: %w", t, err)
		}
	}
	s.logger.Info("all tables dropped for database reset")

	// Run migrations inside the same exclusive transaction so that the
	// schema_migrations inserts cannot race with another concurrent reset.
	if err := migrateOnConn(ctx, conn, AllMigrations()); err != nil {
		s.logger.WithError(err).Error("migration failed during database reset")
		return fmt.Errorf("running migrations after reset: %w", err)
	}

	if _, err := conn.ExecContext(ctx, "COMMIT"); err != nil {
		return fmt.Errorf("committing database reset: %w", err)
	}
	committed = true
	s.logger.Info("database reset completed successfully")
	return nil
}
