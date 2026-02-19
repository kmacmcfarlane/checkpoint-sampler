package store

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

// OpenDB opens a SQLite database at the given path and configures WAL mode,
// busy timeout, and foreign keys. It creates the parent directory if needed.
func OpenDB(dbPath string) (*sql.DB, error) {
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("creating database directory: %w", err)
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("opening database: %w", err)
	}

	pragmas := []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA busy_timeout=5000",
		"PRAGMA foreign_keys=ON",
	}
	for _, p := range pragmas {
		if _, err := db.Exec(p); err != nil {
			db.Close()
			return nil, fmt.Errorf("executing %s: %w", p, err)
		}
	}

	return db, nil
}

// Migrate runs all pending migrations in order. It creates the
// schema_migrations tracking table if it does not exist, then applies
// each migration whose version has not yet been recorded.
func Migrate(db *sql.DB, migrations []Migration) error {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version  INTEGER PRIMARY KEY,
		applied  TEXT NOT NULL
	)`)
	if err != nil {
		return fmt.Errorf("creating schema_migrations table: %w", err)
	}

	for _, m := range migrations {
		applied, err := isMigrationApplied(db, m.Version)
		if err != nil {
			return fmt.Errorf("checking migration %d: %w", m.Version, err)
		}
		if applied {
			continue
		}

		tx, err := db.Begin()
		if err != nil {
			return fmt.Errorf("beginning transaction for migration %d: %w", m.Version, err)
		}

		if _, err := tx.Exec(m.SQL); err != nil {
			tx.Rollback()
			return fmt.Errorf("executing migration %d: %w", m.Version, err)
		}

		now := time.Now().UTC().Format(time.RFC3339)
		if _, err := tx.Exec(
			"INSERT INTO schema_migrations (version, applied) VALUES (?, ?)",
			m.Version, now,
		); err != nil {
			tx.Rollback()
			return fmt.Errorf("recording migration %d: %w", m.Version, err)
		}

		if err := tx.Commit(); err != nil {
			return fmt.Errorf("committing migration %d: %w", m.Version, err)
		}
	}

	return nil
}

func isMigrationApplied(db *sql.DB, version int) (bool, error) {
	var count int
	err := db.QueryRow(
		"SELECT COUNT(*) FROM schema_migrations WHERE version = ?",
		version,
	).Scan(&count)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}
