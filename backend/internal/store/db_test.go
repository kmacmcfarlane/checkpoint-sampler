package store_test

import (
	"database/sql"
	"io"
	"os"
	"path/filepath"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/store"
)

var _ = Describe("OpenDB", func() {
	var tmpDir string

	BeforeEach(func() {
		var err error
		tmpDir, err = os.MkdirTemp("", "store-test-*")
		Expect(err).NotTo(HaveOccurred())
	})

	AfterEach(func() {
		os.RemoveAll(tmpDir)
	})

	It("opens a database and configures pragmas", func() {
		dbPath := filepath.Join(tmpDir, "test.db")
		db, err := store.OpenDB(dbPath)
		Expect(err).NotTo(HaveOccurred())
		defer db.Close()

		// Verify WAL mode
		var journalMode string
		err = db.QueryRow("PRAGMA journal_mode").Scan(&journalMode)
		Expect(err).NotTo(HaveOccurred())
		Expect(journalMode).To(Equal("wal"))

		// Verify busy timeout
		var busyTimeout int
		err = db.QueryRow("PRAGMA busy_timeout").Scan(&busyTimeout)
		Expect(err).NotTo(HaveOccurred())
		Expect(busyTimeout).To(Equal(5000))

		// Verify foreign keys
		var foreignKeys int
		err = db.QueryRow("PRAGMA foreign_keys").Scan(&foreignKeys)
		Expect(err).NotTo(HaveOccurred())
		Expect(foreignKeys).To(Equal(1))
	})

	It("creates the parent directory if it does not exist", func() {
		dbPath := filepath.Join(tmpDir, "subdir", "nested", "test.db")
		db, err := store.OpenDB(dbPath)
		Expect(err).NotTo(HaveOccurred())
		defer db.Close()

		_, err = os.Stat(filepath.Dir(dbPath))
		Expect(err).NotTo(HaveOccurred())
	})
})

var _ = Describe("Migrate", func() {
	var (
		db     *sql.DB
		tmpDir string
	)

	BeforeEach(func() {
		var err error
		tmpDir, err = os.MkdirTemp("", "migrate-test-*")
		Expect(err).NotTo(HaveOccurred())

		dbPath := filepath.Join(tmpDir, "test.db")
		db, err = store.OpenDB(dbPath)
		Expect(err).NotTo(HaveOccurred())
	})

	AfterEach(func() {
		if db != nil {
			db.Close()
		}
		os.RemoveAll(tmpDir)
	})

	It("creates the schema_migrations table", func() {
		err := store.Migrate(db, nil)
		Expect(err).NotTo(HaveOccurred())

		// Verify the table exists by querying it
		var count int
		err = db.QueryRow("SELECT COUNT(*) FROM schema_migrations").Scan(&count)
		Expect(err).NotTo(HaveOccurred())
		Expect(count).To(Equal(0))
	})

	It("applies migrations in order", func() {
		migrations := []store.Migration{
			{Version: 1, SQL: "CREATE TABLE t1 (id TEXT PRIMARY KEY)"},
			{Version: 2, SQL: "CREATE TABLE t2 (id TEXT PRIMARY KEY)"},
		}

		err := store.Migrate(db, migrations)
		Expect(err).NotTo(HaveOccurred())

		// Verify both tables exist
		var name string
		err = db.QueryRow("SELECT name FROM sqlite_master WHERE type='table' AND name='t1'").Scan(&name)
		Expect(err).NotTo(HaveOccurred())
		Expect(name).To(Equal("t1"))

		err = db.QueryRow("SELECT name FROM sqlite_master WHERE type='table' AND name='t2'").Scan(&name)
		Expect(err).NotTo(HaveOccurred())
		Expect(name).To(Equal("t2"))

		// Verify migration records
		var count int
		err = db.QueryRow("SELECT COUNT(*) FROM schema_migrations").Scan(&count)
		Expect(err).NotTo(HaveOccurred())
		Expect(count).To(Equal(2))
	})

	It("is idempotent — running migrations twice has no effect", func() {
		migrations := []store.Migration{
			{Version: 1, SQL: "CREATE TABLE t1 (id TEXT PRIMARY KEY)"},
		}

		err := store.Migrate(db, migrations)
		Expect(err).NotTo(HaveOccurred())

		// Run again — should not error
		err = store.Migrate(db, migrations)
		Expect(err).NotTo(HaveOccurred())

		// Still only one migration record
		var count int
		err = db.QueryRow("SELECT COUNT(*) FROM schema_migrations").Scan(&count)
		Expect(err).NotTo(HaveOccurred())
		Expect(count).To(Equal(1))
	})

	It("skips already-applied migrations and applies new ones", func() {
		// Apply first migration
		migrations1 := []store.Migration{
			{Version: 1, SQL: "CREATE TABLE t1 (id TEXT PRIMARY KEY)"},
		}
		err := store.Migrate(db, migrations1)
		Expect(err).NotTo(HaveOccurred())

		// Add a second migration and run
		migrations2 := []store.Migration{
			{Version: 1, SQL: "CREATE TABLE t1 (id TEXT PRIMARY KEY)"},
			{Version: 2, SQL: "CREATE TABLE t2 (id TEXT PRIMARY KEY)"},
		}
		err = store.Migrate(db, migrations2)
		Expect(err).NotTo(HaveOccurred())

		// Both tables exist
		var count int
		err = db.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('t1','t2')").Scan(&count)
		Expect(err).NotTo(HaveOccurred())
		Expect(count).To(Equal(2))

		// Two migration records
		err = db.QueryRow("SELECT COUNT(*) FROM schema_migrations").Scan(&count)
		Expect(err).NotTo(HaveOccurred())
		Expect(count).To(Equal(2))
	})

	It("records the applied timestamp in RFC 3339 format", func() {
		migrations := []store.Migration{
			{Version: 1, SQL: "CREATE TABLE t1 (id TEXT PRIMARY KEY)"},
		}

		err := store.Migrate(db, migrations)
		Expect(err).NotTo(HaveOccurred())

		var applied string
		err = db.QueryRow("SELECT applied FROM schema_migrations WHERE version = 1").Scan(&applied)
		Expect(err).NotTo(HaveOccurred())
		Expect(applied).To(MatchRegexp(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$`))
	})

	It("returns an error for invalid SQL in a migration", func() {
		migrations := []store.Migration{
			{Version: 1, SQL: "INVALID SQL STATEMENT"},
		}

		err := store.Migrate(db, migrations)
		Expect(err).To(HaveOccurred())
		Expect(err.Error()).To(ContainSubstring("executing migration 1"))
	})

	It("does not apply subsequent migrations if one fails", func() {
		migrations := []store.Migration{
			{Version: 1, SQL: "INVALID SQL"},
			{Version: 2, SQL: "CREATE TABLE t2 (id TEXT PRIMARY KEY)"},
		}

		err := store.Migrate(db, migrations)
		Expect(err).To(HaveOccurred())

		// No migrations should be recorded
		var count int
		err = db.QueryRow("SELECT COUNT(*) FROM schema_migrations").Scan(&count)
		Expect(err).NotTo(HaveOccurred())
		Expect(count).To(Equal(0))

		// t2 should not exist
		err = db.QueryRow("SELECT name FROM sqlite_master WHERE type='table' AND name='t2'").Scan(new(string))
		Expect(err).To(Equal(sql.ErrNoRows))
	})

	It("handles duplicate column errors gracefully (migration is idempotent)", func() {
		// Create a table with a column
		migrations1 := []store.Migration{
			{Version: 1, SQL: "CREATE TABLE test_table (id TEXT PRIMARY KEY, name TEXT)"},
			{Version: 2, SQL: "ALTER TABLE test_table ADD COLUMN age INTEGER NOT NULL DEFAULT 0"},
		}
		err := store.Migrate(db, migrations1)
		Expect(err).NotTo(HaveOccurred())

		// Verify age column exists
		var age int
		err = db.QueryRow("INSERT INTO test_table (id, name, age) VALUES ('test', 'Test', 25) RETURNING age").Scan(&age)
		Expect(err).NotTo(HaveOccurred())
		Expect(age).To(Equal(25))

		// Now simulate the scenario where the column already exists but the migration wasn't recorded
		// (e.g., manual schema change or partial migration failure)
		// Delete the migration record for version 2
		_, err = db.Exec("DELETE FROM schema_migrations WHERE version = 2")
		Expect(err).NotTo(HaveOccurred())

		// Run migrations again — migration 2 should succeed even though column exists
		err = store.Migrate(db, migrations1)
		Expect(err).NotTo(HaveOccurred())

		// Verify migration 2 is now recorded
		var count int
		err = db.QueryRow("SELECT COUNT(*) FROM schema_migrations WHERE version = 2").Scan(&count)
		Expect(err).NotTo(HaveOccurred())
		Expect(count).To(Equal(1))

		// Table should still be functional
		err = db.QueryRow("SELECT age FROM test_table WHERE id = 'test'").Scan(&age)
		Expect(err).NotTo(HaveOccurred())
		Expect(age).To(Equal(25))
	})

	It("handles migrations 5, 6, and 7 idempotently with existing columns", func() {
		// Apply migrations 1-4 to create base tables
		baseMigrations := store.AllMigrations()[:4]
		err := store.Migrate(db, baseMigrations)
		Expect(err).NotTo(HaveOccurred())

		// Manually add width, height, and negative_prompt columns
		// (simulating a database that already has them)
		_, err = db.Exec("ALTER TABLE sample_job_items ADD COLUMN width INTEGER NOT NULL DEFAULT 512")
		Expect(err).NotTo(HaveOccurred())
		_, err = db.Exec("ALTER TABLE sample_job_items ADD COLUMN height INTEGER NOT NULL DEFAULT 512")
		Expect(err).NotTo(HaveOccurred())
		_, err = db.Exec("ALTER TABLE sample_job_items ADD COLUMN negative_prompt TEXT NOT NULL DEFAULT ''")
		Expect(err).NotTo(HaveOccurred())

		// Now run all migrations including 5, 6, and 7 — should succeed
		err = store.Migrate(db, store.AllMigrations())
		Expect(err).NotTo(HaveOccurred())

		// Verify all 8 migrations are recorded
		var count int
		err = db.QueryRow("SELECT COUNT(*) FROM schema_migrations").Scan(&count)
		Expect(err).NotTo(HaveOccurred())
		Expect(count).To(Equal(8))

		// Verify the table is functional with width and height columns
		// First create a sample preset and job to satisfy foreign key constraints
		// (after migration 8, sample_presets uses sampler_scheduler_pairs instead of samplers/schedulers)
		_, err = db.Exec(`
			INSERT INTO sample_presets (
				id, name, prompts, negative_prompt, steps, cfgs, sampler_scheduler_pairs,
				seeds, width, height, created_at, updated_at
			) VALUES (
				'test-preset', 'Test Preset', '["prompt1"]', 'neg', '[20]', '[7.5]',
				'[{"sampler":"euler","scheduler":"normal"}]', '[12345]', 512, 512,
				'2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z'
			)
		`)
		Expect(err).NotTo(HaveOccurred())

		_, err = db.Exec(`
			INSERT INTO sample_jobs (
				id, training_run_name, sample_preset_id, workflow_name, status,
				total_items, created_at, updated_at
			) VALUES (
				'test-job', 'test-run', 'test-preset', 'workflow', 'pending',
				1, '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z'
			)
		`)
		Expect(err).NotTo(HaveOccurred())

		// Now insert a sample job item
		_, err = db.Exec(`
			INSERT INTO sample_job_items (
				id, job_id, checkpoint_filename, comfyui_model_path,
				prompt_name, prompt_text, steps, cfg, sampler_name, scheduler,
				seed, status, width, height, created_at, updated_at
			) VALUES (
				'test-item', 'test-job', 'model.safetensors', '/models/test',
				'prompt1', 'test prompt', 20, 7.5, 'euler', 'normal',
				12345, 'pending', 1024, 768, '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z'
			)
		`)
		Expect(err).NotTo(HaveOccurred())

		var width, height int
		err = db.QueryRow("SELECT width, height FROM sample_job_items WHERE id = 'test-item'").Scan(&width, &height)
		Expect(err).NotTo(HaveOccurred())
		Expect(width).To(Equal(1024))
		Expect(height).To(Equal(768))
	})
})

var _ = Describe("AllMigrations", func() {
	It("returns the presets table as migration 1", func() {
		migrations := store.AllMigrations()
		Expect(migrations).To(HaveLen(8))
		Expect(migrations[0].Version).To(Equal(1))
		Expect(migrations[0].SQL).To(ContainSubstring("CREATE TABLE"))
		Expect(migrations[0].SQL).To(ContainSubstring("presets"))
	})

	It("returns the sample_presets table as migration 2", func() {
		migrations := store.AllMigrations()
		Expect(migrations[1].Version).To(Equal(2))
		Expect(migrations[1].SQL).To(ContainSubstring("CREATE TABLE"))
		Expect(migrations[1].SQL).To(ContainSubstring("sample_presets"))
	})

	It("returns the sample_jobs table as migration 3", func() {
		migrations := store.AllMigrations()
		Expect(migrations[2].Version).To(Equal(3))
		Expect(migrations[2].SQL).To(ContainSubstring("CREATE TABLE"))
		Expect(migrations[2].SQL).To(ContainSubstring("sample_jobs"))
	})

	It("returns the sample_job_items table as migration 4", func() {
		migrations := store.AllMigrations()
		Expect(migrations[3].Version).To(Equal(4))
		Expect(migrations[3].SQL).To(ContainSubstring("CREATE TABLE"))
		Expect(migrations[3].SQL).To(ContainSubstring("sample_job_items"))
	})

	It("returns the width column as migration 5", func() {
		migrations := store.AllMigrations()
		Expect(migrations[4].Version).To(Equal(5))
		Expect(migrations[4].SQL).To(ContainSubstring("ALTER TABLE"))
		Expect(migrations[4].SQL).To(ContainSubstring("width"))
	})

	It("returns the height column as migration 6", func() {
		migrations := store.AllMigrations()
		Expect(migrations[5].Version).To(Equal(6))
		Expect(migrations[5].SQL).To(ContainSubstring("ALTER TABLE"))
		Expect(migrations[5].SQL).To(ContainSubstring("height"))
	})

	It("returns the negative_prompt column as migration 7", func() {
		migrations := store.AllMigrations()
		Expect(migrations[6].Version).To(Equal(7))
		Expect(migrations[6].SQL).To(ContainSubstring("ALTER TABLE"))
		Expect(migrations[6].SQL).To(ContainSubstring("negative_prompt"))
	})

	It("returns the sampler_scheduler_pairs migration as migration 8", func() {
		migrations := store.AllMigrations()
		Expect(migrations[7].Version).To(Equal(8))
		Expect(migrations[7].SQL).To(ContainSubstring("sampler_scheduler_pairs"))
	})
})

var _ = Describe("Presets table migration", func() {
	var (
		db     *sql.DB
		tmpDir string
	)

	BeforeEach(func() {
		var err error
		tmpDir, err = os.MkdirTemp("", "presets-test-*")
		Expect(err).NotTo(HaveOccurred())

		dbPath := filepath.Join(tmpDir, "test.db")
		db, err = store.OpenDB(dbPath)
		Expect(err).NotTo(HaveOccurred())

		err = store.Migrate(db, store.AllMigrations())
		Expect(err).NotTo(HaveOccurred())
	})

	AfterEach(func() {
		if db != nil {
			db.Close()
		}
		os.RemoveAll(tmpDir)
	})

	It("creates the presets table with the expected columns", func() {
		// Insert a row to verify the schema
		_, err := db.Exec(
			"INSERT INTO presets (id, name, mapping, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
			"test-id", "test-preset", `{"x":"cfg"}`, "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z",
		)
		Expect(err).NotTo(HaveOccurred())

		// Read it back
		var id, name, mapping, createdAt, updatedAt string
		err = db.QueryRow("SELECT id, name, mapping, created_at, updated_at FROM presets WHERE id = ?", "test-id").
			Scan(&id, &name, &mapping, &createdAt, &updatedAt)
		Expect(err).NotTo(HaveOccurred())
		Expect(id).To(Equal("test-id"))
		Expect(name).To(Equal("test-preset"))
		Expect(mapping).To(Equal(`{"x":"cfg"}`))
		Expect(createdAt).To(Equal("2025-01-01T00:00:00Z"))
		Expect(updatedAt).To(Equal("2025-01-01T00:00:00Z"))
	})

	It("enforces the primary key constraint on id", func() {
		_, err := db.Exec(
			"INSERT INTO presets (id, name, mapping, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
			"dup-id", "first", "{}", "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z",
		)
		Expect(err).NotTo(HaveOccurred())

		_, err = db.Exec(
			"INSERT INTO presets (id, name, mapping, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
			"dup-id", "second", "{}", "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z",
		)
		Expect(err).To(HaveOccurred())
	})

	It("rejects null name", func() {
		_, err := db.Exec(
			"INSERT INTO presets (id, name, mapping, created_at, updated_at) VALUES (?, NULL, ?, ?, ?)",
			"null-name", "{}", "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z",
		)
		Expect(err).To(HaveOccurred())
	})

	It("rejects null mapping", func() {
		_, err := db.Exec(
			"INSERT INTO presets (id, name, mapping, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)",
			"null-map", "test", "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z",
		)
		Expect(err).To(HaveOccurred())
	})
})

var _ = Describe("ResetDB", func() {
	var (
		s      *store.Store
		tmpDir string
	)

	BeforeEach(func() {
		var err error
		tmpDir, err = os.MkdirTemp("", "reset-db-test-*")
		Expect(err).NotTo(HaveOccurred())

		dbPath := filepath.Join(tmpDir, "test.db")
		db, err := store.OpenDB(dbPath)
		Expect(err).NotTo(HaveOccurred())

		logger := logrus.New()
		logger.SetOutput(io.Discard)
		s, err = store.New(db, logger)
		Expect(err).NotTo(HaveOccurred())
	})

	AfterEach(func() {
		if s != nil {
			s.Close()
		}
		os.RemoveAll(tmpDir)
	})

	It("clears all data from application tables", func() {
		// Insert data into the presets table
		_, err := s.DB().Exec(
			"INSERT INTO presets (id, name, mapping, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
			"test-id", "test-preset", `{"x":"cfg"}`, "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z",
		)
		Expect(err).NotTo(HaveOccurred())

		// Verify data exists
		var count int
		err = s.DB().QueryRow("SELECT COUNT(*) FROM presets").Scan(&count)
		Expect(err).NotTo(HaveOccurred())
		Expect(count).To(Equal(1))

		// Reset the database
		err = s.ResetDB()
		Expect(err).NotTo(HaveOccurred())

		// Verify the table is empty after reset
		err = s.DB().QueryRow("SELECT COUNT(*) FROM presets").Scan(&count)
		Expect(err).NotTo(HaveOccurred())
		Expect(count).To(Equal(0))
	})

	It("recreates all tables with correct schema after reset", func() {
		err := s.ResetDB()
		Expect(err).NotTo(HaveOccurred())

		// Verify all application tables exist
		tables := []string{"presets", "sample_presets", "sample_jobs", "sample_job_items", "schema_migrations"}
		for _, t := range tables {
			var name string
			err := s.DB().QueryRow("SELECT name FROM sqlite_master WHERE type='table' AND name=?", t).Scan(&name)
			Expect(err).NotTo(HaveOccurred(), "expected table %s to exist", t)
			Expect(name).To(Equal(t))
		}

		// Verify we can insert data after reset (schema is correct)
		_, err = s.DB().Exec(
			"INSERT INTO presets (id, name, mapping, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
			"new-id", "new-preset", `{}`, "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z",
		)
		Expect(err).NotTo(HaveOccurred())
	})

	It("clears data across all tables including foreign key chains", func() {
		// Insert data across multiple tables with foreign key relationships
		_, err := s.DB().Exec(`
			INSERT INTO sample_presets (
				id, name, prompts, negative_prompt, steps, cfgs, sampler_scheduler_pairs,
				seeds, width, height, created_at, updated_at
			) VALUES (
				'sp-1', 'Test Preset', '["prompt1"]', 'neg', '[20]', '[7.5]',
				'[{"sampler":"euler","scheduler":"normal"}]', '[42]', 512, 512,
				'2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z'
			)
		`)
		Expect(err).NotTo(HaveOccurred())

		_, err = s.DB().Exec(`
			INSERT INTO sample_jobs (
				id, training_run_name, sample_preset_id, workflow_name, status,
				total_items, created_at, updated_at
			) VALUES (
				'sj-1', 'test-run', 'sp-1', 'workflow.json', 'completed',
				1, '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z'
			)
		`)
		Expect(err).NotTo(HaveOccurred())

		_, err = s.DB().Exec(`
			INSERT INTO sample_job_items (
				id, job_id, checkpoint_filename, comfyui_model_path,
				prompt_name, prompt_text, steps, cfg, sampler_name, scheduler,
				seed, status, width, height, negative_prompt, created_at, updated_at
			) VALUES (
				'sji-1', 'sj-1', 'model.safetensors', '/models/test',
				'prompt1', 'test', 20, 7.5, 'euler', 'normal',
				42, 'completed', 512, 512, '', '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z'
			)
		`)
		Expect(err).NotTo(HaveOccurred())

		// Reset
		err = s.ResetDB()
		Expect(err).NotTo(HaveOccurred())

		// Verify all tables are empty
		for _, table := range []string{"presets", "sample_presets", "sample_jobs", "sample_job_items"} {
			var count int
			err := s.DB().QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count)
			Expect(err).NotTo(HaveOccurred(), "counting rows in %s", table)
			Expect(count).To(Equal(0), "expected %s to be empty after reset", table)
		}
	})

	It("is idempotent — can be called multiple times", func() {
		err := s.ResetDB()
		Expect(err).NotTo(HaveOccurred())

		err = s.ResetDB()
		Expect(err).NotTo(HaveOccurred())

		// Verify schema is intact after double reset
		_, err = s.DB().Exec(
			"INSERT INTO presets (id, name, mapping, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
			"after-double-reset", "test", `{}`, "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z",
		)
		Expect(err).NotTo(HaveOccurred())
	})
})

var _ = Describe("New", func() {
	var tmpDir string

	BeforeEach(func() {
		var err error
		tmpDir, err = os.MkdirTemp("", "store-new-test-*")
		Expect(err).NotTo(HaveOccurred())
	})

	AfterEach(func() {
		os.RemoveAll(tmpDir)
	})

	It("creates a store and runs migrations", func() {
		dbPath := filepath.Join(tmpDir, "test.db")
		db, err := store.OpenDB(dbPath)
		Expect(err).NotTo(HaveOccurred())

		logger := logrus.New()
		logger.SetOutput(io.Discard) // Silence logs in tests
		s, err := store.New(db, logger)
		Expect(err).NotTo(HaveOccurred())
		defer s.Close()

		// Verify presets table exists
		var name string
		err = s.DB().QueryRow("SELECT name FROM sqlite_master WHERE type='table' AND name='presets'").Scan(&name)
		Expect(err).NotTo(HaveOccurred())
		Expect(name).To(Equal("presets"))
	})

	It("is idempotent — can be called multiple times on the same database", func() {
		dbPath := filepath.Join(tmpDir, "test.db")

		logger := logrus.New()
		logger.SetOutput(io.Discard) // Silence logs in tests

		// First store creation
		db1, err := store.OpenDB(dbPath)
		Expect(err).NotTo(HaveOccurred())
		s1, err := store.New(db1, logger)
		Expect(err).NotTo(HaveOccurred())
		s1.Close()

		// Second store creation on same DB
		db2, err := store.OpenDB(dbPath)
		Expect(err).NotTo(HaveOccurred())
		s2, err := store.New(db2, logger)
		Expect(err).NotTo(HaveOccurred())
		defer s2.Close()

		// Verify presets table still works
		_, err = s2.DB().Exec(
			"INSERT INTO presets (id, name, mapping, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
			"test-id", "test", "{}", "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z",
		)
		Expect(err).NotTo(HaveOccurred())
	})
})
