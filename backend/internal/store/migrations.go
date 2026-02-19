package store

// Migration represents a forward-only database migration.
type Migration struct {
	Version int
	SQL     string
}

// AllMigrations returns the ordered list of all database migrations.
func AllMigrations() []Migration {
	return []Migration{
		{
			Version: 1,
			SQL: `CREATE TABLE IF NOT EXISTS presets (
				id         TEXT PRIMARY KEY,
				name       TEXT NOT NULL,
				mapping    TEXT NOT NULL,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			)`,
		},
	}
}
