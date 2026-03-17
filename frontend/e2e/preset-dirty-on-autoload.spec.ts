import { test, expect, type Page } from '@playwright/test'
import { resetDatabase, selectTrainingRun, selectNaiveOptionByLabel, savePresetViaDialog } from './helpers'

/**
 * E2E tests for B-047: Update button missing after changing selector type on preset load.
 *
 * Bug: When the app first loads and the last dimension mapping preset is auto-selected,
 * changing the unified selector value for a dimension does not trigger the dirty flag,
 * so the Update button never appears.
 *
 * The fix extends dirty tracking in PresetSelector to also compare filterModes (in
 * addition to role assignments), so that switching between Single/Multi/Hide modes
 * (which don't change the axis role but do change filterModes) correctly marks the
 * preset as dirty.
 *
 * Test fixture data:
 *   - Training run: "my-model"
 *   - Dimensions: cfg (single-value, disabled), checkpoint (multi-value),
 *     prompt_name (multi-value), seed (single-value, disabled)
 *   - S-080: single-value dimensions have their role select disabled,
 *     so tests must use multi-value dimensions (checkpoint, prompt_name)
 */

/**
 * Changes a dimension's unified mode selector using the Naive UI select by aria-label.
 */
async function changeDimensionMode(page: Page, dimensionName: string, mode: string): Promise<void> {
  await selectNaiveOptionByLabel(page, `Mode for ${dimensionName}`, mode)
}

/**
 * Creates a preset via the API and returns the preset ID.
 * Uses direct API calls to avoid UI interaction overhead.
 */
async function createPresetViaApi(
  request: import('@playwright/test').APIRequestContext,
  name: string,
  mapping: { x?: string; y?: string; slider?: string; combos: string[] },
): Promise<string> {
  const response = await request.post('/api/presets', {
    data: { name, mapping },
  })
  expect(response.ok()).toBeTruthy()
  const preset = await response.json()
  return preset.id
}

test.describe('B-047: preset dirty tracking after auto-load', () => {
  test.beforeEach(async ({ request }) => {
    await resetDatabase(request)
  })

  // AC1, AC3: After app loads with an auto-selected preset, changing any dimension's
  // unified selector value marks the preset as dirty and shows the Update button.
  // This is the core bug scenario: the app loads, preset auto-selects, user changes
  // a filter mode (Single→Multi), and the Update button must appear immediately.
  test('Update button appears after changing filter mode on auto-loaded preset', async ({ page, request }) => {
    // AC: Auto-loaded preset + filter mode change → Update button appears immediately

    // Step 1: Discover the training run ID from the API
    const runsResponse = await request.get('/api/training-runs')
    const runs = await runsResponse.json()
    expect(runs.length).toBeGreaterThan(0)
    const trainingRunId = runs[0].id

    // Step 2: Create a preset via API with checkpoint assigned to X Axis
    // (the bug only manifests when changing filter modes like Single→Multi, not axis roles)
    const presetId = await createPresetViaApi(request, 'Bug-047 Autoload Test', {
      x: 'checkpoint',
      combos: ['prompt_name'],
    })

    // Step 3: Set localStorage so the preset auto-loads on page visit.
    // B-102: eagerAutoSelect reads from checkpoint-sampler-last-training-run (not the preset key),
    // so both keys must be set. The preset key uses the new per-combo format; legacy format
    // is also accepted via migration but the training run key is now required.
    await page.addInitScript(
      ({ runId, pId }: { runId: number; pId: string }) => {
        // New per-combo format for preset persistence
        localStorage.setItem(
          'checkpoint-sampler-last-preset',
          JSON.stringify({ presetsByKey: { [`${runId}|`]: pId } }),
        )
        // Training run key required by eagerAutoSelect (B-102)
        localStorage.setItem(
          'checkpoint-sampler-last-training-run',
          JSON.stringify({ runId, studiesByRunDir: {} }),
        )
      },
      { runId: trainingRunId, pId: presetId },
    )

    // Step 4: Navigate — preset should auto-load
    await page.goto('/')

    // Wait for the drawer to show the Dimensions section (scan complete)
    await expect(page.getByText('Dimensions')).toBeVisible({ timeout: 15000 })

    // Verify the preset is auto-loaded (Delete button is visible when a preset is selected)
    const deleteButton = page.locator('[aria-label="Delete preset"]')
    await expect(deleteButton).toBeVisible()

    // Update button should NOT be visible yet (clean state after auto-load)
    const updateButton = page.locator('[aria-label="Update preset"]')
    await expect(updateButton).not.toBeVisible()

    // Step 5: Change prompt_name's filter mode from 'Single' to 'Multi'
    // This changes filterModes but NOT assignments (role stays 'none' for prompt_name).
    // Before the fix, this would not trigger dirty tracking.
    await changeDimensionMode(page, 'prompt_name', 'Multi')

    // AC1, AC3: Update button must appear immediately after the first change
    await expect(updateButton).toBeVisible()
  })

  // AC2: Dirty tracking correctly compares the loaded preset state against current state
  // for all selector values (both axis roles AND filter modes).
  test('switching filter mode from Single to Hide marks preset dirty after auto-load', async ({ page, request }) => {
    // AC: Single→Hide filter mode change after auto-load triggers dirty state

    const runsResponse = await request.get('/api/training-runs')
    const runs = await runsResponse.json()
    const trainingRunId = runs[0].id

    // Create preset with prompt_name as a combo (so it gets filterMode='single' after load)
    const presetId = await createPresetViaApi(request, 'Bug-047 Hide Test', {
      x: 'checkpoint',
      combos: ['prompt_name'],
    })

    await page.addInitScript(
      ({ runId, pId }: { runId: number; pId: string }) => {
        // New per-combo format for preset persistence (B-102)
        localStorage.setItem(
          'checkpoint-sampler-last-preset',
          JSON.stringify({ presetsByKey: { [`${runId}|`]: pId } }),
        )
        // Training run key required by eagerAutoSelect (B-102)
        localStorage.setItem(
          'checkpoint-sampler-last-training-run',
          JSON.stringify({ runId, studiesByRunDir: {} }),
        )
      },
      { runId: trainingRunId, pId: presetId },
    )

    await page.goto('/')
    await expect(page.getByText('Dimensions')).toBeVisible({ timeout: 15000 })

    // Preset is auto-loaded, clean state
    const updateButton = page.locator('[aria-label="Update preset"]')
    await expect(updateButton).not.toBeVisible()

    // Change prompt_name from Single to Hide
    await changeDimensionMode(page, 'prompt_name', 'Hide')

    // AC2: dirty tracking catches filter mode changes
    await expect(updateButton).toBeVisible()
  })

  // AC1: After app loads with auto-selected preset, changing an axis role also marks dirty.
  // This verifies the existing axis-role dirty tracking still works correctly.
  test('Update button appears after changing axis role on auto-loaded preset', async ({ page, request }) => {
    // AC: Axis role change after auto-load still triggers dirty state

    const runsResponse = await request.get('/api/training-runs')
    const runs = await runsResponse.json()
    const trainingRunId = runs[0].id

    // Create preset with checkpoint as X Axis, prompt_name unassigned
    const presetId = await createPresetViaApi(request, 'Bug-047 Axis Test', {
      x: 'checkpoint',
      combos: ['prompt_name'],
    })

    await page.addInitScript(
      ({ runId, pId }: { runId: number; pId: string }) => {
        // New per-combo format for preset persistence (B-102)
        localStorage.setItem(
          'checkpoint-sampler-last-preset',
          JSON.stringify({ presetsByKey: { [`${runId}|`]: pId } }),
        )
        // Training run key required by eagerAutoSelect (B-102)
        localStorage.setItem(
          'checkpoint-sampler-last-training-run',
          JSON.stringify({ runId, studiesByRunDir: {} }),
        )
      },
      { runId: trainingRunId, pId: presetId },
    )

    await page.goto('/')
    await expect(page.getByText('Dimensions')).toBeVisible({ timeout: 15000 })

    // Preset is auto-loaded, clean state
    const updateButton = page.locator('[aria-label="Update preset"]')
    await expect(updateButton).not.toBeVisible()

    // Change prompt_name from Single (unassigned) to Y Axis
    await changeDimensionMode(page, 'prompt_name', 'Y Axis')

    // Update button appears (axis role changed)
    await expect(updateButton).toBeVisible()
  })

  // AC: Verify clean state — no dirty state when no changes are made after auto-load
  test('Update button does not appear when no changes are made after auto-load', async ({ page, request }) => {
    // AC: Auto-load alone does not create dirty state

    const runsResponse = await request.get('/api/training-runs')
    const runs = await runsResponse.json()
    const trainingRunId = runs[0].id

    const presetId = await createPresetViaApi(request, 'Bug-047 Clean Test', {
      x: 'checkpoint',
      combos: ['prompt_name'],
    })

    await page.addInitScript(
      ({ runId, pId }: { runId: number; pId: string }) => {
        // New per-combo format for preset persistence (B-102)
        localStorage.setItem(
          'checkpoint-sampler-last-preset',
          JSON.stringify({ presetsByKey: { [`${runId}|`]: pId } }),
        )
        // Training run key required by eagerAutoSelect (B-102)
        localStorage.setItem(
          'checkpoint-sampler-last-training-run',
          JSON.stringify({ runId, studiesByRunDir: {} }),
        )
      },
      { runId: trainingRunId, pId: presetId },
    )

    await page.goto('/')
    await expect(page.getByText('Dimensions')).toBeVisible({ timeout: 15000 })

    // Preset is auto-loaded — Update button should NOT be visible (no changes)
    const updateButton = page.locator('[aria-label="Update preset"]')
    await expect(updateButton).not.toBeVisible()

    // Save button should also be disabled (clean state)
    const saveButton = page.locator('[aria-label="Save preset"]')
    await expect(saveButton).toBeDisabled()
  })

  // Regression: Verify the standard workflow still works (preset loaded manually, then filter mode changed)
  test('Update button appears after changing filter mode on manually selected preset', async ({ page, request }) => {
    // AC: Non-auto-load scenario: user selects a preset from the dropdown, then changes filter mode

    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    await expect(page.getByText('Dimensions')).toBeVisible()

    // Create a preset via the UI: click New, assign checkpoint to X Axis, save
    const newButton = page.locator('[aria-label="New preset"]')
    await newButton.click()

    await changeDimensionMode(page, 'checkpoint', 'X Axis')

    // AC: S-121: Save preset via NModal dialog (not window.prompt)
    const presetName = `B047-Manual-${Date.now()}`
    await savePresetViaDialog(page, presetName)

    const saveButton = page.locator('[aria-label="Save preset"]')
    await expect(saveButton).toBeDisabled()

    // Now change prompt_name from Single to Multi
    await changeDimensionMode(page, 'prompt_name', 'Multi')

    // AC: Update button appears (filter mode change detected as dirty)
    const updateButton = page.locator('[aria-label="Update preset"]')
    await expect(updateButton).toBeVisible()
  })
})
