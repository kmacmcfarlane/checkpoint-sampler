# Database Schema

> Source of truth: this document is reconciled against
> `backend/internal/store/migrations.go` (the authoritative migration list) and
> `backend/internal/store/db.go` (driver, pragmas, migration runner). Each table
> below reflects the **final** schema after all migrations through version 26 are
> applied, accounting for table recreations and `ALTER TABLE` add/drop columns.

## 1) Overview

Checkpoint Sampler uses SQLite to persist:

- **presets** — dimension-mapping configurations for the image viewer.
- **studies** — saved sampling-parameter sets used to generate samples.
- **sample_jobs** — generation jobs (one per training run + study + checkpoint selection).
- **sample_job_items** — the individual per-image work units of a job.

Generated-image *metadata* is read from the filesystem (PNG chunks / `.json`
sidecars) at runtime and is not stored in the database.

### 1.1 Driver

Pure-Go SQLite via `modernc.org/sqlite` (no CGO required).

### 1.2 Connection settings

Pragmas are applied via DSN `_pragma` parameters so every pooled connection
inherits them (`store.OpenDB`):

| Setting | Value | Rationale |
|---------|-------|-----------|
| `journal_mode` | WAL | Concurrent reads during writes |
| `busy_timeout` | 5000 (ms) | Avoid immediate `SQLITE_BUSY` on contention |
| `foreign_keys` | ON | Enforce referential integrity |

The connection pool is constrained to a single open connection
(`SetMaxOpenConns(1)`) so `database/sql` never opens a second connection that
would race the first for SQLite's single writer lock. The `foreign_keys`
pragma is verified after open.

### 1.3 Database location

Configured via `db_path` in `config.yaml`. The value is passed directly to
`store.OpenDB` as the SQLite database file path; the parent directory is created
if missing. The default value is `./data/checkpoint-sampler.db`. Config validation
rejects a `db_path` that is a directory or ends with a trailing slash. Persisted
across container restarts via a Docker volume mount.

## 2) Migration strategy

Migrations are **forward-only** and tracked in a `schema_migrations` table
created on startup (`store.Migrate`):

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
    version  INTEGER PRIMARY KEY,
    applied  TEXT NOT NULL  -- RFC 3339 timestamp
);
```

- Each migration (`store.Migration`) has a sequential integer `Version` and a
  `SQL` body. The full ordered list lives in `AllMigrations()`.
- Migrations run at startup, in version order, skipping any version already
  recorded in `schema_migrations`. Each runs in its own transaction; the version
  is recorded on success.
- There is no rollback. To undo or change a schema, add a new forward migration.
- **Column drops / shape changes** are performed by the SQLite "recreate" idiom:
  create a `*_new`/`*_v2`/`*_v3` table with the desired shape, `INSERT ... SELECT`
  the data across, `DROP` the old table, and `RENAME` the new one into place
  (see migrations 8, 10, 11, 13). Because SQLite implicitly commits `ALTER TABLE`
  even inside a transaction, an `ALTER TABLE ... ADD COLUMN` that hits a
  "duplicate column name" error is treated as already-applied and the version is
  recorded (`isDuplicateColumnError`).

`ResetDB` (test-only) drops all application tables and `schema_migrations`, then
re-applies migrations on a single pinned connection under an exclusive
transaction.

### 2.1 Migration history (summary)

The final schema is the result of these migrations:

| Version | Effect |
|---------|--------|
| 1 | Create `presets`. |
| 2 | Create `sample_presets` (later renamed to `studies`). |
| 3 | Create `sample_jobs`. |
| 4 | Create `sample_job_items`. |
| 5–7 | Add `width`, `height`, `negative_prompt` to `sample_job_items`. |
| 8 | Replace `samplers`/`schedulers` columns with `sampler_scheduler_pairs` (recreate `sample_presets`). |
| 9 | Add `prompt_prefix` to `sample_presets`. |
| 10 | Rename `sample_presets` → `studies`; rename `sample_preset_id` → `study_id` and add `study_name` to `sample_jobs`. |
| 11 | Add `ON DELETE CASCADE` to `sample_jobs.study_id` (recreate). |
| 12 | Add `version` to `studies`. |
| 13 | **Drop** `version` from `studies` (recreate); recreate `sample_jobs` FK. |
| 14–16 | Add `exception_type`, `node_type`, `traceback` to `sample_job_items`. |
| 17 | Add `UNIQUE` index on `studies(name)`. |
| 18 | Add `workflow_template`, `vae`, `text_encoder`, `shift` to `studies`. |
| 19 | Add `checkpoint_filenames` to `sample_jobs`. |
| 20 | Add `clear_existing` to `sample_jobs`. |
| 21 | Add `lora_strength_pairs` to `studies`. |
| 22 | Add `base_model` to `sample_jobs`. |
| 23–25 | Add `lora_model_path`, `strength_model`, `strength_clip` to `sample_job_items`. |
| 26 | Add three indexes on `sample_job_items`. |
| 27 | Add `CHECK` constraints on `status` columns (rebuild both job tables). |
| 28 | S-157: add JSON list columns `resolutions`, `vaes`, `text_encoders`, `shifts` to `studies` (backfilled from the legacy scalar columns); add per-item `vae`, `text_encoder`, `shift` to `sample_job_items`. |

> Note: a `studies.version` column existed transiently (added v12, dropped v13)
> and is **not** part of the final schema. Study versioning was replaced by
> immutability + fork; output directories use the study name without a version
> suffix.

## 3) Final schema

### 3.1 presets

Stores named dimension-mapping configurations for the viewer.

```sql
CREATE TABLE presets (
    id          TEXT PRIMARY KEY,   -- UUID
    name        TEXT NOT NULL,
    mapping     TEXT NOT NULL,      -- JSON: dimension-to-role assignments
    created_at  TEXT NOT NULL,      -- RFC 3339
    updated_at  TEXT NOT NULL       -- RFC 3339
);
```

**mapping JSON format:**

```json
{
  "x": "cfg",
  "y": "prompt_name",
  "slider": "checkpoint",
  "combos": ["seed", "index"]
}
```

### 3.2 studies

Stores saved sampling-parameter sets used to generate samples. (Originally
`sample_presets`; renamed in migration 10.)

```sql
CREATE TABLE studies (
    id                       TEXT PRIMARY KEY,                 -- UUID
    name                     TEXT NOT NULL,
    prompt_prefix            TEXT NOT NULL DEFAULT '',
    prompts                  TEXT NOT NULL,                    -- JSON: array of {name, text}
    negative_prompt          TEXT NOT NULL,
    steps                    TEXT NOT NULL,                    -- JSON: array of integers
    cfgs                     TEXT NOT NULL,                    -- JSON: array of floats
    sampler_scheduler_pairs  TEXT NOT NULL,                    -- JSON: array of {sampler, scheduler}
    seeds                    TEXT NOT NULL,                    -- JSON: array of integers
    width                    INTEGER NOT NULL,
    height                   INTEGER NOT NULL,
    created_at               TEXT NOT NULL,                    -- RFC 3339
    updated_at               TEXT NOT NULL,                    -- RFC 3339
    workflow_template        TEXT,                             -- nullable (added v18)
    vae                      TEXT,                             -- nullable (added v18; legacy scalar, mirrors vaes[0])
    text_encoder             TEXT,                             -- nullable (added v18; legacy scalar, mirrors text_encoders[0])
    shift                    REAL,                             -- nullable (added v18; legacy scalar, mirrors shifts[0])
    lora_strength_pairs      TEXT NOT NULL
        DEFAULT '[{"strength_model":1.0,"strength_clip":1.0}]',  -- JSON: array of {strength_model, strength_clip} (added v21)
    -- S-157 multi-value study dimensions (added v28). The legacy scalar
    -- width/height/vae/text_encoder/shift columns are retained and mirror the
    -- first list element for backward-compatible display.
    resolutions              TEXT NOT NULL DEFAULT '[]',        -- JSON: array of {width, height}
    vaes                     TEXT NOT NULL DEFAULT '[]',        -- JSON: array of strings
    text_encoders            TEXT NOT NULL DEFAULT '[]',        -- JSON: array of strings
    shifts                   TEXT NOT NULL DEFAULT '[]'         -- JSON: array of floats
);

-- Migration 17:
CREATE UNIQUE INDEX idx_studies_name_unique ON studies (name);
```

Output directories use the study name (no version suffix):
`{sample_dir}/{study_name}/{checkpoint.safetensors}/`.

### 3.3 sample_jobs

Stores generation jobs. (Originally referenced `sample_presets` via
`sample_preset_id`; renamed to `study_id` with a denormalized `study_name` in
migration 10, recreated with cascading FK in migrations 11 and 13.)

```sql
CREATE TABLE sample_jobs (
    id                    TEXT PRIMARY KEY,                 -- UUID
    training_run_name     TEXT NOT NULL,
    study_id              TEXT NOT NULL,
    study_name            TEXT NOT NULL DEFAULT '',         -- denormalized for display / directory naming
    workflow_name         TEXT NOT NULL,
    vae                   TEXT,                             -- nullable
    clip                  TEXT,                             -- nullable
    shift                 REAL,                             -- nullable
    status                TEXT NOT NULL,
    total_items           INTEGER NOT NULL,
    completed_items       INTEGER NOT NULL DEFAULT 0,
    error_message         TEXT,                             -- nullable
    created_at            TEXT NOT NULL,                    -- RFC 3339
    updated_at            TEXT NOT NULL,                    -- RFC 3339
    checkpoint_filenames  TEXT NOT NULL DEFAULT '[]',       -- JSON array; empty = all checkpoints (added v19)
    clear_existing        INTEGER NOT NULL DEFAULT 0,       -- 0/1; clear sample dirs on first run (added v20)
    base_model            TEXT NOT NULL DEFAULT '',         -- selected base model path for LoRA jobs (added v22)
    FOREIGN KEY (study_id) REFERENCES studies(id) ON DELETE CASCADE
);
```

### 3.4 sample_job_items

Stores the per-image work units of a job.

```sql
CREATE TABLE sample_job_items (
    id                   TEXT PRIMARY KEY,                  -- UUID
    job_id               TEXT NOT NULL,
    checkpoint_filename  TEXT NOT NULL,
    comfyui_model_path   TEXT NOT NULL,
    prompt_name          TEXT NOT NULL,
    prompt_text          TEXT NOT NULL,
    negative_prompt      TEXT NOT NULL DEFAULT '',
    steps                INTEGER NOT NULL,
    cfg                  REAL NOT NULL,
    sampler_name         TEXT NOT NULL,
    scheduler            TEXT NOT NULL,
    seed                 INTEGER NOT NULL,
    status               TEXT NOT NULL,
    comfyui_prompt_id    TEXT,                              -- nullable
    output_path          TEXT,                              -- nullable
    error_message        TEXT,                              -- nullable
    created_at           TEXT NOT NULL,                     -- RFC 3339
    updated_at           TEXT NOT NULL,                     -- RFC 3339
    width                INTEGER NOT NULL DEFAULT 512,      -- added v5
    height               INTEGER NOT NULL DEFAULT 512,      -- added v6
    exception_type       TEXT NOT NULL DEFAULT '',          -- ComfyUI execution_error (added v14)
    node_type            TEXT NOT NULL DEFAULT '',          -- ComfyUI execution_error (added v15)
    traceback            TEXT NOT NULL DEFAULT '',          -- ComfyUI execution_error (added v16)
    lora_model_path      TEXT NOT NULL DEFAULT '',          -- ComfyUI-relative LoRA path (added v23)
    strength_model       REAL NOT NULL DEFAULT 1.0,         -- LoRA model strength (added v24)
    strength_clip        REAL NOT NULL DEFAULT 1.0,         -- LoRA clip strength (added v25)
    FOREIGN KEY (job_id) REFERENCES sample_jobs(id) ON DELETE CASCADE
);

-- Migration 26 indexes:
CREATE INDEX idx_sample_job_items_job_id            ON sample_job_items (job_id);
CREATE INDEX idx_sample_job_items_job_id_status     ON sample_job_items (job_id, status);
CREATE INDEX idx_sample_job_items_job_id_created_at ON sample_job_items (job_id, created_at);
```

> The `negative_prompt` column is present in the original migration-4 table
> definition (with `DEFAULT ''`); migration 7's redundant `ADD COLUMN` is a
> no-op tolerated via the duplicate-column handling in the migration runner.

### 3.5 Indexes (summary)

| Index | Table | Columns | Added in |
|-------|-------|---------|----------|
| `idx_studies_name_unique` | `studies` | `name` (UNIQUE) | v17 |
| `idx_sample_job_items_job_id` | `sample_job_items` | `job_id` | v26 |
| `idx_sample_job_items_job_id_status` | `sample_job_items` | `job_id, status` | v26 |
| `idx_sample_job_items_job_id_created_at` | `sample_job_items` | `job_id, created_at` | v26 |

(Primary-key indexes on each `id` column are implicit.)

## 4) Conventions

- **Primary keys**: UUIDs generated in Go, stored as TEXT.
- **Timestamps**: RFC 3339 strings (e.g. `2025-02-18T12:00:00Z`). Generated in Go, not via SQLite functions.
- **JSON columns**: Stored as TEXT. Serialized/deserialized in the store layer, never in SQL (except the one-time cross-product computed in migration 8).
- **Foreign keys**: `sample_jobs.study_id → studies(id)` and
  `sample_job_items.job_id → sample_jobs(id)`, both `ON DELETE CASCADE`.
- **Store entities**: The store layer defines its own persistence structs,
  separate from domain model types. Conversion happens at the store boundary.
