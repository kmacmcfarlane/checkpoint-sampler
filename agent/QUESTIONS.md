# Questions

Questions from the agent that need user clarification. Update PRD.md or backlog.yaml after answering.

## Q-001: Preset portability across training runs (S-012)
Now that presets are not bound to a single training run, a preset may reference dimension names that don't exist in the currently selected training run. What should happen when loading such a preset?
- **Option A**: Silently apply matching dimensions; ignore any that don't exist in the current scan.
- **Option B**: Apply matching dimensions and show a warning listing the unmatched ones.
- **Option C**: Prevent loading the preset entirely if any dimensions are missing.

### Q-001 Answer:
Option B

## Q-002: Pre-caching scope (NFR / S-011)
PRD section 8 now says "Pre-cache images once the initial set displaying are loaded." US-5 already specifies caching adjacent slider positions. How far should pre-caching go?
- **Option A**: Adjacent slider positions only (current US-5 scope).
- **Option B**: All images from the current scan result (up to ~200 images).
- **Option C**: All images for visible grid cells across all slider positions, then remaining images in the background.

### Q-002 Answer:
Option C