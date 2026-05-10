# Spike: LoRA Sampling Support (S-139)

## Decision Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Discovery | Separate `lora_dirs` config, shared scanner logic | User can point to same dir if desired; metadata analysis distinguishes type |
| TrainingRunKind | `"checkpoint"` / `"lora"` field on TrainingRun | Frontend keys off kind for UI differences |
| Base model | User-selectable at job launch; new `base_model_dir` config key for browsing | Falls back to `checkpoint_dirs[0]` if unset |
| LoRA strength | Iterable `LoraStrengthPair` (model, clip) — like SamplerSchedulerPair | Enables sweeping across strengths |
| Workflow templates | Separate templates; `lora_loader` cs_role discriminates | No bypass hacks; clean graph |
| Output path | `sample_dir/{training_run}/{study}/{base_model}/{lora_checkpoint.safetensors}/` | Extra directory level for base model |
| Multiple LoRAs | Single LoRA per generation (v1); extension point for future stacking | Keep scope tight |
| Adapter types | kohya-style initially (`ss_network_module: networks.lora`); extensible via Kind | Plan for LyCORIS etc. later |

## Architecture Impact

### 1. Config (`model/config.go`, `config.yaml`)

Current:
```go
type Config struct {
    CheckpointDirs []string
    SampleDir      string
    // ...
}
```

Add:
```go
type Config struct {
    CheckpointDirs []string
    LoraDirs       []string   // NEW — directories to scan for LoRA .safetensors
    BaseModelDir   string     // NEW — directory for base model browsing (optional, falls back to checkpoint_dirs[0])
    SampleDir      string
    // ...
}
```

`config.yaml` additions:
```yaml
lora_dirs:
  - /data/loras

# Optional: directory containing base models for LoRA inference.
# If omitted, checkpoint_dirs[0] is used.
base_model_dir: /data/models
```

Docker compose / sandbox: mount `/home/rt/ai/models/stable-diffusion` → `/data/models`.

### 2. Model (`model/training_run.go`)

Add `Kind` field:
```go
type TrainingRunKind string

const (
    TrainingRunKindCheckpoint TrainingRunKind = "checkpoint"
    TrainingRunKindLoRA       TrainingRunKind = "lora"
)

type TrainingRun struct {
    Name        string
    Kind        TrainingRunKind  // NEW
    Checkpoints []Checkpoint
    HasSamples  bool
    // ...
}
```

### 3. Discovery (`service/discovery.go`)

`DiscoveryService` currently scans `checkpointDirs`. Changes:
- Accept `loraDirs` parameter alongside `checkpointDirs`
- Scan LoRA dirs with the same suffix-stripping logic (step/epoch grouping works identically)
- Assign `Kind: TrainingRunKindLoRA` to runs from `loraDirs`, `Kind: TrainingRunKindCheckpoint` to runs from `checkpointDirs`
- No metadata sniffing needed for Kind — directory source is the discriminator

### 4. Workflow Templates (`model/workflow.go`)

Add new cs_role:
```go
const CSRoleLoraLoader CSRole = "lora_loader"
```

Add to `KnownCSRoles()`. The `lora_loader` role substitutes:
- `lora_name` — ComfyUI-relative LoRA path
- `strength_model` — float
- `strength_clip` — float

Template file: `workflows/qwen-image-lora.json` (already created).

### 5. Study Model (DB + API)

Add `LoraStrengthPairs` — stored as JSON in DB, analogous to `SamplerSchedulerPairs`:

```go
type LoraStrengthPair struct {
    StrengthModel float64
    StrengthClip  float64
}
```

DB migration: `ALTER TABLE studies ADD COLUMN lora_strength_pairs TEXT DEFAULT '[]'`

Study fields remain optional — non-LoRA studies simply have empty `lora_strength_pairs`.

### 6. Sample Job Model (DB + API)

Add to `SampleJob`:
- `BaseModel string` — the user-selected base model path (for LoRA jobs)

Add to `SampleJobItem`:
- `LoraModelPath string` — ComfyUI-relative LoRA path
- `StrengthModel float64` — LoRA model strength for this item
- `StrengthClip float64` — LoRA clip strength for this item

DB migration: `ALTER TABLE sample_jobs ADD COLUMN base_model TEXT DEFAULT ''`
DB migration: `ALTER TABLE sample_job_items ADD COLUMN lora_model_path TEXT DEFAULT ''`
DB migration: `ALTER TABLE sample_job_items ADD COLUMN strength_model REAL DEFAULT 1.0`
DB migration: `ALTER TABLE sample_job_items ADD COLUMN strength_clip REAL DEFAULT 1.0`

### 7. Job Execution (`service/job_executor.go`)

In `substituteWorkflow`, add case for `CSRoleLoraLoader`:
```go
case model.CSRoleLoraLoader:
    inputs["lora_name"] = item.LoraModelPath
    inputs["strength_model"] = item.StrengthModel
    inputs["strength_clip"] = item.StrengthClip
```

For LoRA jobs, the `unet_loader` role gets `job.BaseModel` instead of `item.ComfyUIModelPath`.

### 8. Path Matching

New `LoraPathMatcher` — queries ComfyUI's LoRA model list (via `object_info/LoraLoader`) instead of UNET list. Same filename-matching logic.

Add `ComfyUIModelTypeLoRA` to the model type enum.

### 9. Job Expansion (`service/sample_job.go`)

`expandJobItems` currently iterates: checkpoints × prompts × steps × cfgs × sampler_scheduler_pairs × seeds.

For LoRA runs, add `lora_strength_pairs` to the Cartesian product:
checkpoints × prompts × steps × cfgs × sampler_scheduler_pairs × seeds × **lora_strength_pairs**

Non-LoRA runs skip the strength dimension (or treat it as a single `[{1.0, 1.0}]`).

### 10. Output Path (`service/job_executor.go`)

Current: `sample_dir/{training_run_sanitized}/{study_id}/{checkpoint.safetensors}/`

LoRA: `sample_dir/{training_run_sanitized}/{study_id}/{base_model_name}/{lora_checkpoint.safetensors}/`

The `base_model_name` is extracted from the base model path (filename without extension).

### 11. Viewer Discovery (`service/viewer_discovery.go`)

Must handle the extra directory level for LoRA output paths. Detection: if a non-safetensors directory exists between the study dir and the checkpoint dirs, treat it as the base model level.

### 12. Frontend

- **Training run list**: Show `Kind` badge (LoRA vs Checkpoint)
- **Job launch dialog**: When Kind=LoRA, show base model dropdown (populated from `base_model_dir` browsing API or config) and hide/show LoRA-specific fields
- **Study/preset editor**: Add LoRA strength pairs editor (model + clip columns, analogous to sampler/scheduler pairs)
- **Image filename dimensions**: `strength_model` and `strength_clip` appear as filterable dimensions in the grid

### 13. API (Goa DSL)

- `TrainingRunResponse`: add `kind` field
- `StudyPayload` / `StudyResponse`: add `lora_strength_pairs` field
- `SampleJobCreatePayload`: add `base_model` field
- New endpoint or extend existing: `GET /api/base-models` — list available base models from `base_model_dir`
- `ComfyUIDiscoveryResponse`: add LoRA model type to available models

### 14. Goa DSL / Config API

Add `base_model_dir` to config response so frontend knows whether base model selection is available.

## Extension Points (Future)

- **Multiple LoRAs per generation**: Add `lora_loaders` (plural) cs_role, extend SampleJobItem with LoRA stack
- **LyCORIS / LoHa**: TrainingRunKind enum extensible; `ss_network_module` metadata can distinguish adapter types
- **Auto-detect base model**: Parse `ss_base_model_version` from metadata, map to known model filenames
- **LoRA strength as dimension**: Already planned — strength pairs in the Cartesian product create filterable dimensions

## Implementation Order

Stories should be ordered for incremental delivery:
1. Config + model foundations (Kind, lora_dirs, base_model_dir)
2. Discovery (scan lora_dirs, assign Kind)
3. Workflow template system (lora_loader cs_role)
4. Study model (LoraStrengthPairs)
5. Job creation + execution (base model, LoRA substitution, path matching)
6. Output path + viewer discovery (extra directory level)
7. API layer (DSL updates, codegen)
8. Frontend (UI for LoRA selection, strength editor, base model dropdown)
