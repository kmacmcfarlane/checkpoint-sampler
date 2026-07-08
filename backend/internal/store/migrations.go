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
				negative_prompt     TEXT NOT NULL DEFAULT '',
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
			SQL:     `ALTER TABLE sample_job_items ADD COLUMN exception_type TEXT NOT NULL DEFAULT '';`,
		},
		{
			// Add node_type column for ComfyUI execution_error events.
			Version: 15,
			SQL:     `ALTER TABLE sample_job_items ADD COLUMN node_type TEXT NOT NULL DEFAULT '';`,
		},
		{
			// Add traceback column for ComfyUI execution_error events.
			Version: 16,
			SQL:     `ALTER TABLE sample_job_items ADD COLUMN traceback TEXT NOT NULL DEFAULT '';`,
		},
		{
			// Add UNIQUE constraint on studies.name to enforce uniqueness at the
			// database level, complementing the service-layer check and preventing
			// race conditions in concurrent-user scenarios.
			Version: 17,
			SQL:     `CREATE UNIQUE INDEX IF NOT EXISTS idx_studies_name_unique ON studies (name);`,
		},
		{
			// Add workflow_template, vae, text_encoder, and shift columns to the
			// studies table. These settings were previously job-level fields;
			// moving them into the study definition ensures they are stored once
			// per study and automatically used when generating samples.
			// All columns are nullable to support existing studies created before
			// this migration.
			Version: 18,
			SQL: `ALTER TABLE studies ADD COLUMN workflow_template TEXT;
ALTER TABLE studies ADD COLUMN vae TEXT;
ALTER TABLE studies ADD COLUMN text_encoder TEXT;
ALTER TABLE studies ADD COLUMN shift REAL;`,
		},
		{
			// Add checkpoint_filenames column to sample_jobs table.
			// Stores a JSON-encoded array of checkpoint filenames selected at job creation.
			// NULL / empty means all checkpoints in the training run were included.
			Version: 19,
			SQL:     `ALTER TABLE sample_jobs ADD COLUMN checkpoint_filenames TEXT NOT NULL DEFAULT '[]';`,
		},
		{
			// B-114: Add clear_existing column to sample_jobs table.
			// Stores whether sample directories should be cleared when the job
			// first transitions to running (not at queue time). Defaults to 0
			// (false) for existing jobs so that resumed jobs never re-clear.
			Version: 20,
			SQL:     `ALTER TABLE sample_jobs ADD COLUMN clear_existing INTEGER NOT NULL DEFAULT 0;`,
		},
		{
			// S-143: Add lora_strength_pairs column to studies table.
			// Stores a JSON array of {strength_model, strength_clip} pairs,
			// analogous to sampler_scheduler_pairs. Defaults to empty array.
			// Non-LoRA studies simply have an empty array.
			Version: 21,
			SQL:     `ALTER TABLE studies ADD COLUMN lora_strength_pairs TEXT NOT NULL DEFAULT '[{"strength_model":1.0,"strength_clip":1.0}]';`,
		},
		{
			// S-145: Add base_model column to sample_jobs table.
			// Stores the user-selected base model path for LoRA jobs.
			// Empty string for checkpoint jobs.
			Version: 22,
			SQL:     `ALTER TABLE sample_jobs ADD COLUMN base_model TEXT NOT NULL DEFAULT '';`,
		},
		{
			// S-145: Add lora_model_path column to sample_job_items table.
			// Stores the ComfyUI-relative LoRA model path for LoRA items.
			// Empty string for checkpoint items.
			Version: 23,
			SQL:     `ALTER TABLE sample_job_items ADD COLUMN lora_model_path TEXT NOT NULL DEFAULT '';`,
		},
		{
			// S-145: Add strength_model column to sample_job_items table.
			// Stores the LoRA model strength for this item.
			// Defaults to 1.0 for both LoRA and checkpoint items.
			// NOTE(S-156): This DDL DEFAULT 1.0 is legacy. The service layer now
			// applies the strength default explicitly when creating new items, so
			// direct SQL inserts via the store always carry an explicit value.
			Version: 24,
			SQL:     `ALTER TABLE sample_job_items ADD COLUMN strength_model REAL NOT NULL DEFAULT 1.0;`,
		},
		{
			// S-145: Add strength_clip column to sample_job_items table.
			// Stores the LoRA clip strength for this item.
			// Defaults to 1.0 for both LoRA and checkpoint items.
			// NOTE(S-156): This DDL DEFAULT 1.0 is legacy. The service layer now
			// applies the strength default explicitly when creating new items, so
			// direct SQL inserts via the store always carry an explicit value.
			Version: 25,
			SQL:     `ALTER TABLE sample_job_items ADD COLUMN strength_clip REAL NOT NULL DEFAULT 1.0;`,
		},
		{
			// B-149: Add indexes on sample_job_items to eliminate full table scans.
			//   - idx_sample_job_items_job_id speeds up per-job item lookups.
			//   - idx_sample_job_items_job_id_status backs the aggregate
			//     COUNT(*) ... GROUP BY job_id, status used by the job list path.
			//   - idx_sample_job_items_job_id_created_at backs the ordered
			//     item-listing query used by the executor (ORDER BY created_at).
			// Without these, every item query was a full table scan of
			// sample_job_items.
			Version: 26,
			SQL: `CREATE INDEX IF NOT EXISTS idx_sample_job_items_job_id ON sample_job_items (job_id);
CREATE INDEX IF NOT EXISTS idx_sample_job_items_job_id_status ON sample_job_items (job_id, status);
CREATE INDEX IF NOT EXISTS idx_sample_job_items_job_id_created_at ON sample_job_items (job_id, created_at);`,
		},
		{
			// S-156: Add CHECK constraints on status columns for sample_jobs and
			// sample_job_items. SQLite does not support ALTER TABLE ADD CONSTRAINT,
			// so both tables are rebuilt using the create/copy/drop/rename pattern.
			//
			// Valid statuses are the exact values the executor handles — inserting
			// any other value now fails at the DB layer instead of silently
			// persisting an unhandled status string.
			//
			// Data copy order:
			//   1. Create staging tables and copy all rows from both old tables.
			//   2. Drop old child table (sample_job_items) first so that the
			//      ON DELETE CASCADE FK from items→jobs cannot fire when the
			//      parent (sample_jobs) is subsequently dropped.
			//   3. Drop old parent (sample_jobs).
			//   4. Rename staging tables into their final names.
			//   5. Re-create the indexes from migration 26 (DROP TABLE removes them).
			//
			// sample_job_items_new references sample_jobs_v4 (not the old
			// sample_jobs) so that when sample_jobs is dropped the new items
			// table is not affected by cascade. After the RENAME chain completes
			// (sample_jobs_v4 → sample_jobs), SQLite automatically updates the
			// FK reference in the renamed items table to point to sample_jobs.
			Version: 27,
			SQL: `CREATE TABLE sample_jobs_v4 (
				id                  TEXT PRIMARY KEY,
				training_run_name   TEXT NOT NULL,
				study_id            TEXT NOT NULL,
				study_name          TEXT NOT NULL DEFAULT '',
				workflow_name       TEXT NOT NULL,
				vae                 TEXT,
				clip                TEXT,
				shift               REAL,
				status              TEXT NOT NULL CHECK (status IN ('pending','running','stopped','completed','completed_with_errors','failed')),
				total_items         INTEGER NOT NULL,
				completed_items     INTEGER NOT NULL DEFAULT 0,
				error_message       TEXT,
				created_at          TEXT NOT NULL,
				updated_at          TEXT NOT NULL,
				checkpoint_filenames TEXT NOT NULL DEFAULT '[]',
				clear_existing      INTEGER NOT NULL DEFAULT 0,
				base_model          TEXT NOT NULL DEFAULT '',
				FOREIGN KEY (study_id) REFERENCES studies(id) ON DELETE CASCADE
			);
			INSERT INTO sample_jobs_v4 (id, training_run_name, study_id, study_name, workflow_name, vae, clip, shift, status, total_items, completed_items, error_message, created_at, updated_at, checkpoint_filenames, clear_existing, base_model)
			SELECT id, training_run_name, study_id, study_name, workflow_name, vae, clip, shift, status, total_items, completed_items, error_message, created_at, updated_at, checkpoint_filenames, clear_existing, base_model
			FROM sample_jobs;

			CREATE TABLE sample_job_items_new (
				id                  TEXT PRIMARY KEY,
				job_id              TEXT NOT NULL,
				checkpoint_filename TEXT NOT NULL,
				comfyui_model_path  TEXT NOT NULL,
				prompt_name         TEXT NOT NULL,
				prompt_text         TEXT NOT NULL,
				negative_prompt     TEXT NOT NULL DEFAULT '',
				steps               INTEGER NOT NULL,
				cfg                 REAL NOT NULL,
				sampler_name        TEXT NOT NULL,
				scheduler           TEXT NOT NULL,
				seed                INTEGER NOT NULL,
				status              TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed','skipped')),
				comfyui_prompt_id   TEXT,
				output_path         TEXT,
				error_message       TEXT,
				width               INTEGER NOT NULL DEFAULT 512,
				height              INTEGER NOT NULL DEFAULT 512,
				exception_type      TEXT NOT NULL DEFAULT '',
				node_type           TEXT NOT NULL DEFAULT '',
				traceback           TEXT NOT NULL DEFAULT '',
				lora_model_path     TEXT NOT NULL DEFAULT '',
				strength_model      REAL NOT NULL DEFAULT 1.0,
				strength_clip       REAL NOT NULL DEFAULT 1.0,
				created_at          TEXT NOT NULL,
				updated_at          TEXT NOT NULL,
				FOREIGN KEY (job_id) REFERENCES sample_jobs_v4(id) ON DELETE CASCADE
			);
			INSERT INTO sample_job_items_new (id, job_id, checkpoint_filename, comfyui_model_path, prompt_name, prompt_text, negative_prompt, steps, cfg, sampler_name, scheduler, seed, status, comfyui_prompt_id, output_path, error_message, width, height, exception_type, node_type, traceback, lora_model_path, strength_model, strength_clip, created_at, updated_at)
			SELECT id, job_id, checkpoint_filename, comfyui_model_path, prompt_name, prompt_text, negative_prompt, steps, cfg, sampler_name, scheduler, seed, status, comfyui_prompt_id, output_path, error_message, width, height, exception_type, node_type, traceback, lora_model_path, strength_model, strength_clip, created_at, updated_at
			FROM sample_job_items;

			DROP TABLE sample_job_items;
			DROP TABLE sample_jobs;
			ALTER TABLE sample_jobs_v4 RENAME TO sample_jobs;
			ALTER TABLE sample_job_items_new RENAME TO sample_job_items;

			CREATE INDEX IF NOT EXISTS idx_sample_job_items_job_id ON sample_job_items (job_id);
			CREATE INDEX IF NOT EXISTS idx_sample_job_items_job_id_status ON sample_job_items (job_id, status);
			CREATE INDEX IF NOT EXISTS idx_sample_job_items_job_id_created_at ON sample_job_items (job_id, created_at);`,
		},
		{
			// S-157: Promote Resolution, VAE, Text Encoder, and Shift to multi-value
			// study dimensions. Add JSON list columns to the studies table and
			// backfill each existing scalar into a single-element list (empty when
			// the scalar was NULL/empty). The legacy scalar columns
			// (width/height/vae/text_encoder/shift) are retained and continue to
			// mirror the first list element for backward-compatible display.
			//
			// Add per-item vae/text_encoder/shift columns to sample_job_items so the
			// job executor can substitute the resolved value for each work item in
			// the cross-product (resolution reuses the existing width/height columns).
			Version: 28,
			SQL: `ALTER TABLE studies ADD COLUMN resolutions TEXT NOT NULL DEFAULT '[]';
ALTER TABLE studies ADD COLUMN vaes TEXT NOT NULL DEFAULT '[]';
ALTER TABLE studies ADD COLUMN text_encoders TEXT NOT NULL DEFAULT '[]';
ALTER TABLE studies ADD COLUMN shifts TEXT NOT NULL DEFAULT '[]';
UPDATE studies SET resolutions = json_array(json_object('width', width, 'height', height));
UPDATE studies SET vaes = CASE WHEN vae IS NULL OR vae = '' THEN '[]' ELSE json_array(vae) END;
UPDATE studies SET text_encoders = CASE WHEN text_encoder IS NULL OR text_encoder = '' THEN '[]' ELSE json_array(text_encoder) END;
UPDATE studies SET shifts = CASE WHEN shift IS NULL THEN '[]' ELSE json_array(shift) END;
ALTER TABLE sample_job_items ADD COLUMN vae TEXT NOT NULL DEFAULT '';
ALTER TABLE sample_job_items ADD COLUMN text_encoder TEXT NOT NULL DEFAULT '';
ALTER TABLE sample_job_items ADD COLUMN shift REAL;`,
		},
	}
}
