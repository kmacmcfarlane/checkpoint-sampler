# Database Schema

## 1) Overview

Checkpoint Sampler uses SQLite for persisting user preferences (dimension mapping presets). The database is lightweight — image metadata is scanned from the filesystem at runtime, not stored in the DB.

### 1.1 Driver

Pure-Go SQLite via `modernc.org/sqlite` (no CGO required).

### 1.2 Connection settings

Applied on every connection open:

| Setting | Value | Rationale |
|---------|-------|-----------|
| `journal_mode` | WAL | Concurrent reads during writes |
| `busy_timeout` | 5000 (ms) | Avoid immediate SQLITE_BUSY on contention |
| `foreign_keys` | ON | Enforce referential integrity |

### 1.3 Database location

Configured via `db_path` in `config.toml`. Default: `./data/checkpoint-sampler.db`. Persisted across container restarts via a Docker volume mount.

## 2) Migration strategy

Forward-only migrations tracked in a `schema_migrations` table:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
    version  INTEGER PRIMARY KEY,
    applied  TEXT NOT NULL  -- RFC 3339 timestamp
);
```

- Each migration has a sequential integer version.
- Migrations run at startup, in order, skipping already-applied versions.
- Migrations are idempotent (use `IF NOT EXISTS` / `IF EXISTS` where applicable).
- There is no rollback mechanism. To undo a migration, create a new forward migration.

## 3) Schema

### 3.1 presets

Stores named dimension mapping configurations.

```sql
CREATE TABLE presets (
    id               TEXT PRIMARY KEY,   -- UUID
    name             TEXT NOT NULL,
    training_run_id  TEXT NOT NULL,      -- matches training run name from config
    mapping          TEXT NOT NULL,      -- JSON: dimension-to-role assignments
    created_at       TEXT NOT NULL,      -- RFC 3339
    updated_at       TEXT NOT NULL       -- RFC 3339
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

### 3.2 Indexes

```sql
CREATE INDEX idx_presets_training_run ON presets(training_run_id);
```

## 4) Conventions

- **Primary keys**: UUIDs generated in Go (`google/uuid`), stored as TEXT.
- **Timestamps**: RFC 3339 strings (e.g., `2025-02-18T12:00:00Z`). Generated in Go, not via SQLite functions.
- **JSON columns**: Stored as TEXT. Serialized/deserialized in the store layer, never in SQL.
- **Store entities**: The store layer defines its own persistence structs, separate from domain model types. Conversion happens at the store boundary.
