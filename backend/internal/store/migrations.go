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
		{
			Version: 9,
			SQL:     `ALTER TABLE sample_presets ADD COLUMN prompt_prefix TEXT NOT NULL DEFAULT '';`,
		},
		{
			// Rename sample_presets table to studies.
			// Rename sample_preset_id column in sample_jobs to study_id.
			// Add study_name column to sample_jobs (denormalized for display/directory naming).
			Version: 10,
			SQL: `ALTER TABLE sample_presets RENAME TO studies;

			CREATE TABLE sample_jobs_new (
				id                 TEXT PRIMARY KEY,
				training_run_name  TEXT NOT NULL,
				study_id           TEXT NOT NULL,
				study_name         TEXT NOT NULL DEFAULT '',
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
				FOREIGN KEY (study_id) REFERENCES studies(id)
			);
			INSERT INTO sample_jobs_new (id, training_run_name, study_id, study_name, workflow_name, vae, clip, shift, status, total_items, completed_items, error_message, created_at, updated_at)
			SELECT sj.id, sj.training_run_name, sj.sample_preset_id,
				COALESCE((SELECT s.name FROM studies s WHERE s.id = sj.sample_preset_id), ''),
				sj.workflow_name, sj.vae, sj.clip, sj.shift, sj.status, sj.total_items, sj.completed_items, sj.error_message, sj.created_at, sj.updated_at
			FROM sample_jobs sj;
			DROP TABLE sample_jobs;
			ALTER TABLE sample_jobs_new RENAME TO sample_jobs;`,
		},
		{
			// Add ON DELETE CASCADE to the study_id foreign key on sample_jobs.
			// Without this, deleting a study that has associated sample_jobs
			// fails with FOREIGN KEY constraint error (787).
			Version: 11,
			SQL: `CREATE TABLE sample_jobs_v2 (
				id                 TEXT PRIMARY KEY,
				training_run_name  TEXT NOT NULL,
				study_id           TEXT NOT NULL,
				study_name         TEXT NOT NULL DEFAULT '',
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
				FOREIGN KEY (study_id) REFERENCES studies(id) ON DELETE CASCADE
			);
			INSERT INTO sample_jobs_v2 (id, training_run_name, study_id, study_name, workflow_name, vae, clip, shift, status, total_items, completed_items, error_message, created_at, updated_at)
			SELECT id, training_run_name, study_id, study_name, workflow_name, vae, clip, shift, status, total_items, completed_items, error_message, created_at, updated_at
			FROM sample_jobs;
			DROP TABLE sample_jobs;
			ALTER TABLE sample_jobs_v2 RENAME TO sample_jobs;`,
		},
		{
			// Add version column to studies table. Starts at 1, incremented
			// each time the study's configuration is updated. The version
			// number is included in the output directory name.
			Version: 12,
			SQL:     `ALTER TABLE studies ADD COLUMN version INTEGER NOT NULL DEFAULT 1;`,
		},
		{
			// Drop the version column from studies table. Study versioning
			// is replaced by immutability + fork: studies with generated
			// samples are either forked (new study) or regenerated in-place.
			// Output directories use just the study name (no version suffix).
			// SQLite does not support DROP COLUMN in older versions, so we
			// recreate the table without the version column.
			Version: 13,
			SQL: `CREATE TABLE studies_v2 (
				id                       TEXT PRIMARY KEY,
				name                     TEXT NOT NULL,
				prompt_prefix            TEXT NOT NULL DEFAULT '',
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
			INSERT INTO studies_v2 (id, name, prompt_prefix, prompts, negative_prompt, steps, cfgs, sampler_scheduler_pairs, seeds, width, height, created_at, updated_at)
			SELECT id, name, prompt_prefix, prompts, negative_prompt, steps, cfgs, sampler_scheduler_pairs, seeds, width, height, created_at, updated_at
			FROM studies;
			DROP TABLE studies;
			ALTER TABLE studies_v2 RENAME TO studies;

			-- Recreate sample_jobs table with FK pointing to new studies table
			CREATE TABLE sample_jobs_v3 (
				id                 TEXT PRIMARY KEY,
				training_run_name  TEXT NOT NULL,
				study_id           TEXT NOT NULL,
				study_name         TEXT NOT NULL DEFAULT '',
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
				FOREIGN KEY (study_id) REFERENCES studies(id) ON DELETE CASCADE
			);
			INSERT INTO sample_jobs_v3 (id, training_run_name, study_id, study_name, workflow_name, vae, clip, shift, status, total_items, completed_items, error_message, created_at, updated_at)
			SELECT id, training_run_name, study_id, study_name, workflow_name, vae, clip, shift, status, total_items, completed_items, error_message, created_at, updated_at
			FROM sample_jobs;
			DROP TABLE sample_jobs;
			ALTER TABLE sample_jobs_v3 RENAME TO sample_jobs;`,
		},
		{
			// Add exception_type column for ComfyUI execution_error events.
			Version: 14,
			SQL: `ALTER TABLE sample_job_items ADD COLUMN exception_type TEXT NOT NULL DEFAULT '';`,
		},
		{
			// Add node_type column for ComfyUI execution_error events.
			Version: 15,
			SQL: `ALTER TABLE sample_job_items ADD COLUMN node_type TEXT NOT NULL DEFAULT '';`,
		},
		{
			// Add traceback column for ComfyUI execution_error events.
			Version: 16,
			SQL: `ALTER TABLE sample_job_items ADD COLUMN traceback TEXT NOT NULL DEFAULT '';`,
		},
	}
}
