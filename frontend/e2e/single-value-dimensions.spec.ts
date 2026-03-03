import { test, expect, type Page } from '@playwright/test'
import { resetDatabase, selectTrainingRun } from './helpers'

/**
 * E2E tests for single-value dimension behavior (S-080).
 *
 * Story S-080: Disable and sort single-value dimensions to bottom
 *
 * Verifies that dimensions with only one unique value are:
 *   - Sorted to the bottom of the DimensionPanel list
 *   - Visually disabled (greyed out via opacity)
 *   - Cannot be assigned to X, Y, or Slider roles (role select disabled)
 *   - Can still have filter mode set (filter mode select remains enabled)
 *
 * Test fixture data:
 *   - Training run: "my-model"
 *   - Dimensions after scan:
 *       cfg: values ["7"] -- single-value
 *       checkpoint: values ["1000", "2000"] -- multi-value
 *       prompt_name: values ["landscape", "portrait"] -- multi-value
 *       seed: values ["42"] -- single-value
 *   - Expected sorted order: checkpoint, prompt_name (multi), then cfg, seed (single)
 */

test.describe('single-value dimension behavior (S-080)', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetDatabase(request)
    await page.goto('/')
    await selectTrainingRun(page, 'my-model')
    // Wait for scan to complete (Dimensions panel appears)
    await expect(page.getByText('Dimensions')).toBeVisible()
  })

  // AC1: Dimensions with only one unique value are sorted to the bottom of the DimensionPanel list
  test('single-value dimensions are sorted to the bottom of the list', async ({ page }) => {
    // The dimension panel renders rows with data-testid="dimension-row-<name>"
    // After sorting, multi-value dims (checkpoint, prompt_name) should come first,
    // then single-value dims (cfg, seed) at the bottom.
    const dimensionRows = page.locator('[data-testid^="dimension-row-"]')
    await expect(dimensionRows).toHaveCount(4)

    // Read the order of dimension names from the rendered rows
    const names: string[] = []
    for (let i = 0; i < 4; i++) {
      const name = await dimensionRows.nth(i).locator('.dimension-name').textContent()
      names.push(name!.trim())
    }

    // Multi-value dimensions (checkpoint, prompt_name) should appear before
    // single-value dimensions (cfg, seed). The backend returns alphabetical order:
    // cfg, checkpoint, prompt_name, seed. After sorting:
    // checkpoint, prompt_name (multi-value first), cfg, seed (single-value last)
    expect(names[0]).toBe('checkpoint')
    expect(names[1]).toBe('prompt_name')
    expect(names[2]).toBe('cfg')
    expect(names[3]).toBe('seed')
  })

  // AC2: Single-value dimensions are visually disabled (greyed out)
  test('single-value dimension rows have the disabled CSS class', async ({ page }) => {
    // Multi-value dimensions should NOT have the disabled class
    const checkpointRow = page.locator('[data-testid="dimension-row-checkpoint"]')
    await expect(checkpointRow).toBeVisible()
    await expect(checkpointRow).not.toHaveClass(/dimension-row--disabled/)

    const promptNameRow = page.locator('[data-testid="dimension-row-prompt_name"]')
    await expect(promptNameRow).toBeVisible()
    await expect(promptNameRow).not.toHaveClass(/dimension-row--disabled/)

    // Single-value dimensions SHOULD have the disabled class
    const cfgRow = page.locator('[data-testid="dimension-row-cfg"]')
    await expect(cfgRow).toBeVisible()
    await expect(cfgRow).toHaveClass(/dimension-row--disabled/)

    const seedRow = page.locator('[data-testid="dimension-row-seed"]')
    await expect(seedRow).toBeVisible()
    await expect(seedRow).toHaveClass(/dimension-row--disabled/)
  })

  // AC2: Single-value dimensions cannot be assigned to X, Y, or Slider roles (disabled NSelect)
  test('role select is disabled for single-value dimensions', async ({ page }) => {
    // The role NSelect for single-value dimensions should be disabled
    const cfgRoleSelect = page.locator('[aria-label="Role for cfg"]')
    await expect(cfgRoleSelect).toBeVisible()

    // Check that the NSelect has cursor-not-allowed or is functionally disabled.
    // Naive UI adds the n-select--disabled class when disabled.
    const cfgSelectWrapper = page.locator('[data-testid="dimension-row-cfg"] .dimension-role-select')
    await expect(cfgSelectWrapper.locator('.n-base-selection--disabled')).toBeVisible()

    const seedSelectWrapper = page.locator('[data-testid="dimension-row-seed"] .dimension-role-select')
    await expect(seedSelectWrapper.locator('.n-base-selection--disabled')).toBeVisible()

    // Multi-value dimensions should NOT be disabled
    const checkpointSelectWrapper = page.locator('[data-testid="dimension-row-checkpoint"] .dimension-role-select')
    await expect(checkpointSelectWrapper.locator('.n-base-selection--disabled')).toHaveCount(0)
  })

  // AC3: Single-value dimensions can still have filter mode set
  test('filter mode select remains enabled for single-value dimensions', async ({ page }) => {
    // The filter mode NSelect for single-value dimensions (with role=none) should NOT be disabled
    const cfgFilterWrapper = page.locator('[data-testid="dimension-row-cfg"] .dimension-filter-select')
    await expect(cfgFilterWrapper).toBeVisible()
    // It should NOT have the disabled class
    await expect(cfgFilterWrapper.locator('.n-base-selection--disabled')).toHaveCount(0)

    const seedFilterWrapper = page.locator('[data-testid="dimension-row-seed"] .dimension-filter-select')
    await expect(seedFilterWrapper).toBeVisible()
    await expect(seedFilterWrapper.locator('.n-base-selection--disabled')).toHaveCount(0)
  })
})
