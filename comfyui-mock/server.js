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
 *                                    UNETLoader, KSampler
 *   POST /prompt                   → accepts workflow submission, returns a prompt_id
 *                                    UUID; schedules async WS completion event
 *   GET  /history/:promptId        → returns history entry with a fake output image
 *   GET  /view                     → returns a minimal 1×1 PNG image
 *   POST /queue                    → cancel stub (returns 200)
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
 * Configured via environment variables:
 *   PORT  (default: 8188)
 *   CHECKPOINT_FILENAMES  (comma-separated list; used in UNETLoader object_info)
 */

'use strict';

const http = require('http');
const { WebSocketServer } = require('ws');
const { randomUUID } = require('crypto');

const PORT = parseInt(process.env.PORT || '8188', 10);

// Checkpoint filenames known to this mock (used in object_info UNETLoader)
const CHECKPOINT_FILENAMES = (process.env.CHECKPOINT_FILENAMES || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

console.log(`[comfyui-mock] Starting on port ${PORT}`);
console.log(`[comfyui-mock] Known checkpoint files: ${CHECKPOINT_FILENAMES.join(', ')}`);

// Minimal 1x1 PNG (base64-encoded)
// This is a valid 1x1 white PNG file, used as the dummy output image
const MINIMAL_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI6QAAAABJRU5ErkJggg==';
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
 */
function sendExecutionCompleteAsync(clientId, promptId) {
  // Use a short delay so the HTTP response for POST /prompt returns before
  // WS events arrive, matching real ComfyUI behaviour.
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
  }, 100);
}

// --- HTTP server -------------------------------------------------------------

const server = http.createServer((req, res) => {
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

  // Fallback
  console.warn(`[comfyui-mock] 404: ${method} ${pathname}`);
  return jsonResponse(res, 404, { error: `not found: ${pathname}` });
});

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

// --- Helpers -----------------------------------------------------------------

function jsonResponse(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

// --- WebSocket upgrade handling ----------------------------------------------

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/ws') {
    wss.handleUpgrade(req, socket, head, ws => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

// --- Start -------------------------------------------------------------------

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[comfyui-mock] Listening on 0.0.0.0:${PORT}`);
});

process.on('SIGTERM', () => {
  console.log('[comfyui-mock] SIGTERM received, shutting down');
  server.close();
  process.exit(0);
});
