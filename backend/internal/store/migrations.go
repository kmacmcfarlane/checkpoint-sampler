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
		{
			Version: 2,
			SQL: `CREATE TABLE IF NOT EXISTS sample_presets (
				id              TEXT PRIMARY KEY,
				name            TEXT NOT NULL,
				prompts         TEXT NOT NULL,
				negative_prompt TEXT NOT NULL,
				steps           TEXT NOT NULL,
				cfgs            TEXT NOT NULL,
				samplers        TEXT NOT NULL,
				schedulers      TEXT NOT NULL,
				seeds           TEXT NOT NULL,
				width           INTEGER NOT NULL,
				height          INTEGER NOT NULL,
				created_at      TEXT NOT NULL,
				updated_at      TEXT NOT NULL
			)`,
		},
		{
			Version: 3,
			SQL: `CREATE TABLE IF NOT EXISTS sample_jobs (
				id                 TEXT PRIMARY KEY,
				training_run_name  TEXT NOT NULL,
				sample_preset_id   TEXT NOT NULL,
				workflow_name      TEXT NOT NULL,
				vae                TEXT,
				clip               TEXT,
				shift              REAL,
				status             TEXT NOT NULL,
				total_items        INTEGER NOT NULL,
				completed_items    INTEGER NOT NULL DEFAULT 0,
				error_message      TEXT,
				created_at         TEXT NOT NULL,
				updated_at         TEXT NOT NULL,
				FOREIGN KEY (sample_preset_id) REFERENCES sample_presets(id)
			)`,
		},
		{
			Version: 4,
			SQL: `CREATE TABLE IF NOT EXISTS sample_job_items (
				id                  TEXT PRIMARY KEY,
				job_id              TEXT NOT NULL,
				checkpoint_filename TEXT NOT NULL,
				comfyui_model_path  TEXT NOT NULL,
				prompt_name         TEXT NOT NULL,
				prompt_text         TEXT NOT NULL,
				steps               INTEGER NOT NULL,
				cfg                 REAL NOT NULL,
				sampler_name        TEXT NOT NULL,
				scheduler           TEXT NOT NULL,
				seed                INTEGER NOT NULL,
				status              TEXT NOT NULL,
				comfyui_prompt_id   TEXT,
				output_path         TEXT,
				error_message       TEXT,
				created_at          TEXT NOT NULL,
				updated_at          TEXT NOT NULL,
				FOREIGN KEY (job_id) REFERENCES sample_jobs(id) ON DELETE CASCADE
			)`,
		},
		{
			Version: 5,
			SQL:     `ALTER TABLE sample_job_items ADD COLUMN width INTEGER NOT NULL DEFAULT 512;`,
		},
		{
			Version: 6,
			SQL:     `ALTER TABLE sample_job_items ADD COLUMN height INTEGER NOT NULL DEFAULT 512;`,
		},
	}
}
