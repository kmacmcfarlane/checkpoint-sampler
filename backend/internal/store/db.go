package store

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// OpenDB opens a SQLite database at the given path and configures WAL mode,
// busy timeout, and foreign keys. It creates the parent directory if needed.
//
// Pragmas are set via DSN _pragma parameters so that every connection opened
// by Go's database/sql pool inherits them. A plain db.Exec("PRAGMA ...")
// only applies to the single connection that executes the statement; other
// pool connections would not have foreign_keys enabled.
func OpenDB(dbPath string) (*sql.DB, error) {
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("creating database directory: %w", err)
	}

	dsn := fmt.Sprintf("file:%s?_pragma=journal_mode%%28WAL%%29&_pragma=busy_timeout%%285000%%29&_pragma=foreign_keys%%281%%29",
		dbPath,
	)

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("opening database: %w", err)
	}

	// Verify that pragmas were applied correctly on the connection.
	var fkEnabled int
	if err := db.QueryRow("PRAGMA foreign_keys").Scan(&fkEnabled); err != nil {
		db.Close()
		return nil, fmt.Errorf("verifying foreign_keys pragma: %w", err)
	}
	if fkEnabled != 1 {
		db.Close()
		return nil, fmt.Errorf("foreign_keys pragma not enabled (got %d)", fkEnabled)
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
			// If this is a "duplicate column" error, the column already exists,
			// which is the desired end state. Record the migration as applied.
			// Note: In SQLite, ALTER TABLE is implicitly committed even inside
			// a transaction, so if we get a duplicate column error, we just need
			// to record the migration version.
			if isDuplicateColumnError(err) {
				if recordErr := recordMigrationOutsideTx(db, m.Version); recordErr != nil {
					return fmt.Errorf("recording migration %d after duplicate column: %w", m.Version, recordErr)
				}
				continue
			}
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

// isDuplicateColumnError checks if the error is a SQLite "duplicate column name" error.
func isDuplicateColumnError(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "duplicate column name")
}

// recordMigrationOutsideTx records a migration version outside of a transaction.
// This is used when ALTER TABLE fails with duplicate column error (the ALTER
// is already committed in SQLite even inside a transaction).
func recordMigrationOutsideTx(db *sql.DB, version int) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := db.Exec(
		"INSERT INTO schema_migrations (version, applied) VALUES (?, ?)",
		version, now,
	)
	return err
}
