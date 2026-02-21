# IDEAS

## Keyboard navigation for sliders
Arrow keys (left/right) could step through slider values when a cell is focused. This would complement mouse-based slider interaction for power users reviewing many checkpoints quickly.

## Slider animation / playback mode
A "play" button on the master slider that auto-advances through values at a configurable interval. Useful for quickly scanning through checkpoint progression without manual slider dragging.

## Parse safetensors checkpoint metadata
Read `ss_*` metadata embedded in .safetensors checkpoint files (via safetensors header) to extract training configuration: output name, total steps, epochs, optimizer, dataset info, base model name, etc. Could be used to enrich training run display in the UI or auto-configure grouping. Readable via `safetensors.safe_open(path).metadata()`.

## JSON sidecar metadata per image
Write a JSON sidecar file alongside each generated image containing flat key-value generation metadata (checkpoint, prompt, seed, CFG, steps, sampler, dimensions, etc.). This could be produced by a custom ComfyUI output node or by parsing the PNG `Prompt` metadata (which contains the full ComfyUI node graph as JSON) and flattening it. Sidecars would make metadata extraction trivial for the tool and decouple it from ComfyUI-specific PNG embedding. Aligns with future plans to handle more of the generation pipeline within this tool.

## View image/checkpoint metadata in the UI
Display sidecar metadata (and/or parsed PNG metadata) in the UI — e.g., a metadata panel that appears when hovering or clicking an image, showing generation parameters (prompt, seed, CFG, steps, sampler, checkpoint name). Could also show training run metadata from safetensors headers at the training run level.
