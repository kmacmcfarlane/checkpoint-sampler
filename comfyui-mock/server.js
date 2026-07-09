/**
 * ComfyUI Mock Server for E2E testing.
 *
 * ## Design
 *
 * This lightweight HTTP+WebSocket stub replicates the ComfyUI API surface used
 * by the checkpoint-sampler backend. It runs as a Docker service inside
 * docker-compose.test.yml and allows the full sample generation flow to be
 * exercised in E2E tests without a real GPU or ComfyUI installation.
 *
 * ## Endpoints implemented
 *
 * HTTP:
 *   GET  /system_stats             → {"system": {}} (health check)
 *   GET  /object_info/:nodeType    → returns model lists for VAELoader, CLIPLoader,
 *                                    UNETLoader, LoraLoader, KSampler
 *   POST /prompt                   → accepts workflow submission, returns a prompt_id
 *                                    UUID; schedules async WS completion event
 *   GET  /history/:promptId        → returns history entry with a fake output image
 *   GET  /view                     → returns a minimal 1×1 PNG image
 *   POST /queue                    → cancel stub (returns 200)
 *   POST /mock/config              → runtime configuration (delay_ms only; test-only)
 *   GET  /mock/config              → return current runtime configuration
 *
 * WebSocket:
 *   WS /ws?clientId=<id>           → accepts WS connections; receives prompt_id via
 *                                    POST /prompt and sends:
 *                                    1. {"type":"executing", "data":{"prompt_id","node":"1"}}
 *                                    2. {"type":"progress", "data":{"prompt_id","value":N,"max":3}}
 *                                       (3 progress steps simulating sampler inference, S-073)
 *                                    3. {"type":"executing", "data":{"prompt_id","node":null}}
 *                                    (null node signals execution complete to the executor)
 *
 * ## Checkpoint model names
 *
 * The /object_info/UNETLoader response includes the checkpoint filenames from
 * test-fixtures. This allows CheckpointPathMatcher to resolve them and create
 * job items with valid ComfyUI model paths.
 *
 * ## Slow-motion mode (W-018)
 *
 * The mock supports a configurable delay before sending the WS execution-complete
 * events. This allows E2E tests to reliably observe the in-flight/running phase
 * (e.g. mid-generation parameters display) without relying on polling luck.
 *
 * The delay can be configured two ways:
 *   1. Startup: COMFYUI_MOCK_DELAY_MS env var (applies to all prompts from startup)
 *   2. Runtime: POST /mock/config with {"delay_ms": N} (adjustable per-test at runtime)
 *
 * Configured via environment variables:
 *   PORT                  (default: 8188)
 *   CHECKPOINT_FILENAMES  (comma-separated list; used in UNETLoader object_info)
 *   LORA_FILENAMES        (comma-separated list; used in LoraLoader object_info,
 *                          so LoraPathMatcher can resolve LoRA checkpoint filenames
 *                          to ComfyUI model paths for LoRA sample jobs)
 *   COMFYUI_MOCK_DELAY_MS (default: 0; milliseconds to delay WS execution-complete)
 *   CONTROL_PORT          (default: 8189; always-on control plane, see below)
 *
 * ## Offline simulation (S-161)
 *
 * To exercise "ComfyUI unreachable" scenarios (e.g. a job created while ComfyUI
 * is down, or a connection error mid-execution), the main API port (PORT) can be
 * taken down and brought back up at runtime without restarting the container.
 * This causes real TCP-level connection-refused errors on the backend side
 * (rather than an HTTP error response), matching how the backend's
 * isConnectionError() classifies genuine outages.
 *
 * A separate always-listening control server (CONTROL_PORT) is used to toggle
 * this, since the main port itself is unreachable while "down":
 *   POST /control/comfyui  {"down": true}   → close the main port, drop WS clients
 *   POST /control/comfyui  {"down": false}  → reopen the main port
 *   GET  /control/comfyui                   → {"down": bool}
 */

'use strict';

const http = require('http');
const { WebSocketServer } = require('ws');
const { randomUUID } = require('crypto');

const PORT = parseInt(process.env.PORT || '8188', 10);
const CONTROL_PORT = parseInt(process.env.CONTROL_PORT || '8189', 10);

// Checkpoint filenames known to this mock (used in object_info UNETLoader)
const CHECKPOINT_FILENAMES = (process.env.CHECKPOINT_FILENAMES || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// LoRA filenames known to this mock (used in object_info LoraLoader, B-162)
const LORA_FILENAMES = (process.env.LORA_FILENAMES || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// Configurable delay before WS execution-complete events are sent.
// Can be set at startup via COMFYUI_MOCK_DELAY_MS env var, or at runtime
// via POST /mock/config {"delay_ms": N}. Default: 0 (no delay).
let mockDelayMs = parseInt(process.env.COMFYUI_MOCK_DELAY_MS || '0', 10);
if (isNaN(mockDelayMs) || mockDelayMs < 0) mockDelayMs = 0;

console.log(`[comfyui-mock] Starting on port ${PORT}`);
console.log(`[comfyui-mock] Known checkpoint files: ${CHECKPOINT_FILENAMES.join(', ')}`);
console.log(`[comfyui-mock] Known LoRA files: ${LORA_FILENAMES.join(', ')}`);
console.log(`[comfyui-mock] Initial delay: ${mockDelayMs}ms`);

// Minimal 1x1 white PNG (base64-encoded).
// This is a structurally valid PNG with correct CRC checksums on all chunks.
// The previous base64 had an invalid IDAT CRC, causing Go's image.Decode to
// fail with "png: invalid format: invalid checksum" when generating thumbnails.
// Generated via Python's struct/zlib with verified chunk CRCs.
const MINIMAL_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
const MINIMAL_PNG = Buffer.from(MINIMAL_PNG_B64, 'base64');

// In-memory store: promptId → {clientId, filename}
const promptStore = new Map();

// Map clientId → WebSocket connection
const wsClients = new Map();

// --- WebSocket server --------------------------------------------------------

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const clientId = url.searchParams.get('clientId') || randomUUID();
  wsClients.set(clientId, ws);
  console.log(`[comfyui-mock] WS connected: clientId=${clientId}`);

  ws.on('close', () => {
    wsClients.delete(clientId);
    console.log(`[comfyui-mock] WS disconnected: clientId=${clientId}`);
  });
  ws.on('error', err => {
    console.error(`[comfyui-mock] WS error for clientId=${clientId}:`, err.message);
  });
});

/**
 * Send execution-complete events to the WebSocket client associated with
 * the given clientId and promptId.
 *
 * ComfyUI signals completion by sending an "executing" event with node=null.
 * The backend executor listens for this event to trigger image download.
 *
 * The total delay before completion events is 100ms (HTTP-response guard) plus
 * mockDelayMs (slow-motion mode, W-018). This allows E2E tests to observe the
 * in-flight/running UI state by setting mockDelayMs to a large value.
 */
function sendExecutionCompleteAsync(clientId, promptId) {
  // Capture the current delay value at the time of the call so that a
  // concurrent POST /mock/config does not affect in-flight prompts.
  const delayMs = mockDelayMs;

  // Use a short guard so the HTTP response for POST /prompt returns before
  // WS events arrive (matching real ComfyUI behaviour), plus the configured
  // slow-motion delay (default 0).
  const initialDelay = 100 + delayMs;

  console.log(`[comfyui-mock] Scheduling execution-complete for prompt_id=${promptId} delay=${initialDelay}ms`);

  setTimeout(() => {
    const ws = wsClients.get(clientId);
    if (!ws || ws.readyState !== 1 /* OPEN */) {
      console.warn(`[comfyui-mock] No WS client for clientId=${clientId}, cannot send completion`);
      return;
    }

    // Step 1: "executing" with a node id (simulates processing)
    ws.send(JSON.stringify({
      type: 'executing',
      data: { prompt_id: promptId, node: '1' },
    }));

    // Step 2: Send per-node inference progress events (simulates sampler steps).
    // ComfyUI sends "progress" events with value/max as each sampler step completes.
    // We send 3 progress steps (1/3, 2/3, 3/3) to exercise the inference progress
    // bar in E2E tests (S-073).
    const PROGRESS_STEPS = 3;
    for (let step = 1; step <= PROGRESS_STEPS; step++) {
      setTimeout(() => {
        if (ws.readyState !== 1) return;
        ws.send(JSON.stringify({
          type: 'progress',
          data: { prompt_id: promptId, value: step, max: PROGRESS_STEPS },
        }));
        console.log(`[comfyui-mock] Sent progress ${step}/${PROGRESS_STEPS} for prompt_id=${promptId}`);
      }, step * 10);
    }

    // Step 3: "executing" with node=null (signals completion)
    setTimeout(() => {
      if (ws.readyState !== 1) return;
      ws.send(JSON.stringify({
        type: 'executing',
        data: { prompt_id: promptId, node: null },
      }));
      console.log(`[comfyui-mock] Sent execution complete for prompt_id=${promptId}`);
    }, (PROGRESS_STEPS + 1) * 10 + 20);
  }, initialDelay);
}

// --- HTTP server -------------------------------------------------------------

// mainServer holds the currently listening main API server, or null while
// simulated-offline (S-161). isDown tracks the desired state for GET /control/comfyui.
let mainServer = null;
let isDown = false;

function mainRequestHandler(req, res) {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // Log every request at trace level
  console.log(`[comfyui-mock] ${method} ${pathname}`);

  // --- GET /system_stats (health check) ---
  if (method === 'GET' && pathname === '/system_stats') {
    return jsonResponse(res, 200, { system: {} });
  }

  // --- GET /object_info/:nodeType ---
  if (method === 'GET' && pathname.startsWith('/object_info')) {
    const nodeType = pathname.replace('/object_info', '').replace(/^\//, '');
    return handleObjectInfo(res, nodeType);
  }

  // --- POST /prompt ---
  if (method === 'POST' && pathname === '/prompt') {
    return handleSubmitPrompt(req, res);
  }

  // --- GET /history/:promptId ---
  if (method === 'GET' && pathname.startsWith('/history')) {
    const promptId = pathname.replace('/history', '').replace(/^\//, '');
    return handleGetHistory(res, promptId);
  }

  // --- GET /view (download image) ---
  if (method === 'GET' && pathname === '/view') {
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': MINIMAL_PNG.length,
    });
    return res.end(MINIMAL_PNG);
  }

  // --- POST /queue (cancel stub) ---
  if (method === 'POST' && pathname === '/queue') {
    return jsonResponse(res, 200, {});
  }

  // --- POST /mock/config (runtime configuration, W-018) ---
  // Allows E2E tests to set mockDelayMs at runtime without restarting the container.
  // Example: POST /mock/config {"delay_ms": 5000}  → enables slow-motion mode
  //          POST /mock/config {"delay_ms": 0}      → resets to instant mode
  if (method === 'POST' && pathname === '/mock/config') {
    return handleMockConfig(req, res);
  }

  // --- GET /mock/config (read current runtime configuration) ---
  if (method === 'GET' && pathname === '/mock/config') {
    return jsonResponse(res, 200, { delay_ms: mockDelayMs });
  }

  // Fallback
  console.warn(`[comfyui-mock] 404: ${method} ${pathname}`);
  return jsonResponse(res, 404, { error: `not found: ${pathname}` });
}

// --- Handlers ----------------------------------------------------------------

function handleObjectInfo(res, nodeType) {
  if (nodeType === 'UNETLoader') {
    return jsonResponse(res, 200, {
      UNETLoader: {
        input: {
          required: {
            unet_name: [CHECKPOINT_FILENAMES, {}],
            weight_dtype: [['default', 'fp8_e4m3fn', 'fp8_e5m2'], {}],
          },
          optional: {},
        },
        output: ['MODEL'],
        category: 'loaders',
        name: 'UNETLoader',
      },
    });
  }

  if (nodeType === 'LoraLoader') {
    return jsonResponse(res, 200, {
      LoraLoader: {
        input: {
          required: {
            lora_name: [LORA_FILENAMES, {}],
            strength_model: [['FLOAT'], { default: 1.0 }],
            strength_clip: [['FLOAT'], { default: 1.0 }],
          },
          optional: {},
        },
        output: ['MODEL', 'CLIP'],
        category: 'loaders',
        name: 'LoraLoader',
      },
    });
  }

  if (nodeType === 'VAELoader') {
    return jsonResponse(res, 200, {
      VAELoader: {
        input: {
          required: {
            vae_name: [['test-vae.safetensors'], {}],
          },
          optional: {},
        },
        output: ['VAE'],
        category: 'loaders',
        name: 'VAELoader',
      },
    });
  }

  if (nodeType === 'CLIPLoader') {
    return jsonResponse(res, 200, {
      CLIPLoader: {
        input: {
          required: {
            clip_name: [['test-clip.safetensors'], {}],
            type: [['sdxl', 'sd3', 'flux', 'mochi', 'ltxv', 'pixart', 'cosmos', 'lumina2', 'wan', 'hidream'], {}],
          },
          optional: {},
        },
        output: ['CLIP'],
        category: 'loaders',
        name: 'CLIPLoader',
      },
    });
  }

  if (nodeType === 'KSampler') {
    return jsonResponse(res, 200, {
      KSampler: {
        input: {
          required: {
            model: [['MODEL'], {}],
            seed: [['INT'], { default: 0 }],
            steps: [['INT'], { default: 20 }],
            cfg: [['FLOAT'], { default: 7.0 }],
            sampler_name: [['euler', 'euler_ancestral', 'heun', 'dpm_2', 'dpm_2_ancestral', 'lms', 'dpm_fast', 'dpm_adaptive', 'dpmpp_2s_ancestral', 'dpmpp_sde', 'dpmpp_sde_gpu', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_2m_sde_gpu', 'dpmpp_3m_sde', 'dpmpp_3m_sde_gpu', 'ddpm', 'lcm', 'ipndm', 'ipndm_v', 'deis', 'ddim', 'uni_pc', 'uni_pc_bh2', 'res_multistep'], {}],
            scheduler: [['normal', 'karras', 'exponential', 'sgm_uniform', 'simple', 'ddim_uniform', 'beta', 'linear_quadratic', 'kl_optimal'], {}],
          },
          optional: {},
        },
        output: ['LATENT'],
        category: 'sampling',
        name: 'KSampler',
      },
    });
  }

  // Generic fallback for unknown node types
  return jsonResponse(res, 200, {});
}

function handleSubmitPrompt(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk.toString(); });
  req.on('end', () => {
    let payload;
    try {
      payload = JSON.parse(body);
    } catch (e) {
      return jsonResponse(res, 400, { error: 'invalid JSON' });
    }

    const promptId = randomUUID();
    const clientId = payload.client_id || '';

    // Store for history lookup
    promptStore.set(promptId, {
      clientId,
      filename: `ComfyUI_${promptId.replace(/-/g, '').slice(0, 8)}_00001_.png`,
    });

    console.log(`[comfyui-mock] POST /prompt → prompt_id=${promptId} clientId=${clientId}`);

    // Schedule WS completion event
    if (clientId) {
      sendExecutionCompleteAsync(clientId, promptId);
    } else {
      console.warn('[comfyui-mock] No clientId in prompt request; WS events will not be sent');
    }

    return jsonResponse(res, 200, {
      prompt_id: promptId,
      number: 1,
      node_errors: {},
    });
  });
}

function handleGetHistory(res, promptId) {
  const entry = promptStore.get(promptId);
  if (!entry) {
    // Return empty history (prompt not found)
    return jsonResponse(res, 200, {});
  }

  return jsonResponse(res, 200, {
    [promptId]: {
      prompt: [],
      outputs: {
        save_image_node: {
          images: [
            {
              filename: entry.filename,
              subfolder: '',
              type: 'output',
            },
          ],
        },
      },
      status: { status_str: 'success', completed: true },
    },
  });
}

function handleMockConfig(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk.toString(); });
  req.on('end', () => {
    let payload;
    try {
      payload = JSON.parse(body);
    } catch (e) {
      return jsonResponse(res, 400, { error: 'invalid JSON' });
    }

    if (typeof payload.delay_ms !== 'number' || payload.delay_ms < 0) {
      return jsonResponse(res, 400, { error: 'delay_ms must be a non-negative number' });
    }

    mockDelayMs = Math.floor(payload.delay_ms);
    console.log(`[comfyui-mock] Runtime config updated: delay_ms=${mockDelayMs}`);
    return jsonResponse(res, 200, { delay_ms: mockDelayMs });
  });
}

// --- Helpers -----------------------------------------------------------------

function jsonResponse(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

function mainUpgradeHandler(req, socket, head) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/ws') {
    wss.handleUpgrade(req, socket, head, ws => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
}

// --- Main server lifecycle (S-161 offline simulation) ------------------------

/**
 * Start the main API server (HTTP + WS upgrade) on PORT. No-op if already up.
 */
function startMain() {
  if (mainServer) return;
  mainServer = http.createServer(mainRequestHandler);
  mainServer.on('upgrade', mainUpgradeHandler);
  mainServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[comfyui-mock] main server listening on 0.0.0.0:${PORT}`);
  });
}

/**
 * Stop the main API server, forcibly dropping any open WebSocket clients so the
 * backend observes an immediate disconnect. cb is called once the port is
 * released. No-op (calls cb synchronously) if already down.
 */
function stopMain(cb) {
  if (!mainServer) {
    cb();
    return;
  }
  for (const ws of wsClients.values()) {
    try { ws.terminate(); } catch (e) { /* ignore */ }
  }
  wsClients.clear();
  const s = mainServer;
  mainServer = null;
  s.close(() => {
    console.log('[comfyui-mock] main server stopped (simulated offline)');
    cb();
  });
}

// --- Control server (always listening, S-161) ---------------------------------
//
// A separate, always-up control plane so tests can toggle the main server off
// and back on. The main port itself is unreachable while "down", so the
// control endpoint must live on its own port.

const controlServer = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${CONTROL_PORT}`);
  const { pathname } = parsedUrl;
  const { method } = req;

  if (method === 'POST' && pathname === '/control/comfyui') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      let payload;
      try {
        payload = body ? JSON.parse(body) : {};
      } catch (e) {
        return jsonResponse(res, 400, { error: 'invalid JSON' });
      }
      if (typeof payload.down !== 'boolean') {
        return jsonResponse(res, 400, { error: 'down must be a boolean' });
      }
      isDown = payload.down;
      if (isDown) {
        stopMain(() => jsonResponse(res, 200, { down: true }));
      } else {
        startMain();
        jsonResponse(res, 200, { down: false });
      }
    });
    return;
  }

  if (method === 'GET' && pathname === '/control/comfyui') {
    return jsonResponse(res, 200, { down: isDown });
  }

  console.warn(`[comfyui-mock] control 404: ${method} ${pathname}`);
  return jsonResponse(res, 404, { error: `not found: ${pathname}` });
});

// --- Start ---------------------------------------------------------------

startMain();
controlServer.listen(CONTROL_PORT, '0.0.0.0', () => {
  console.log(`[comfyui-mock] control server listening on 0.0.0.0:${CONTROL_PORT}`);
});

process.on('SIGTERM', () => {
  console.log('[comfyui-mock] SIGTERM received, shutting down');
  if (mainServer) mainServer.close();
  controlServer.close();
  process.exit(0);
});
