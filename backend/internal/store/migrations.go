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
		{
			Version: 7,
			SQL:     `ALTER TABLE sample_job_items ADD COLUMN negative_prompt TEXT NOT NULL DEFAULT '';`,
		},
		{
			// Replace independent samplers and schedulers columns with
			// sampler_scheduler_pairs (JSON array of {sampler, scheduler} objects).
			// Existing presets are migrated by computing the cross-product of their
			// current samplers x schedulers lists into explicit pairs.
			Version: 8,
			SQL: `CREATE TABLE sample_presets_new (
				id                       TEXT PRIMARY KEY,
				name                     TEXT NOT NULL,
				prompts                  TEXT NOT NULL,
				negative_prompt          TEXT NOT NULL,
				steps                    TEXT NOT NULL,
				cfgs                     TEXT NOT NULL,
				sampler_scheduler_pairs  TEXT NOT NULL,
				seeds                    TEXT NOT NULL,
				width                    INTEGER NOT NULL,
				height                   INTEGER NOT NULL,
				created_at               TEXT NOT NULL,
				updated_at               TEXT NOT NULL
			);
			INSERT INTO sample_presets_new (id, name, prompts, negative_prompt, steps, cfgs, sampler_scheduler_pairs, seeds, width, height, created_at, updated_at)
			SELECT
				sp.id, sp.name, sp.prompts, sp.negative_prompt, sp.steps, sp.cfgs,
				COALESCE(
					(SELECT json_group_array(json_object('sampler', s.value, 'scheduler', sc.value))
					 FROM json_each(sp.samplers) AS s, json_each(sp.schedulers) AS sc),
					'[]'
				),
				sp.seeds, sp.width, sp.height, sp.created_at, sp.updated_at
			FROM sample_presets sp;
			DROP TABLE sample_presets;
			ALTER TABLE sample_presets_new RENAME TO sample_presets;`,
		},
	}
}
