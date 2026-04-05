import { test, expect } from '@playwright/test'

test.describe('Demo app — real-time sync', () => {
  test('page loads with two panels', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Window A')).toBeVisible()
    await expect(page.getByText('Window B')).toBeVisible()
  })

  test('typing in Panel A syncs to Panel B', async ({ context }) => {
    test.setTimeout(30_000)
    const pageA = await context.newPage()
    const pageB = await context.newPage()

    await pageA.goto('/')
    await pageB.goto('/')

    // Wait for both to connect
    await pageA.waitForTimeout(1500)

    const textareaA = pageA.locator('textarea').first()
    const textareaB = pageB.locator('textarea').first()

    await textareaA.fill('hello from panel A')

    // Allow sync time
    await pageB.waitForTimeout(2000)

    const valueB = await textareaB.inputValue()
    expect(valueB).toContain('hello')
  })

  test('offline toggle button exists', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Go Offline').first()).toBeVisible()
  })

  test('going offline shows offline badge', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(500)
    const offlineBtn = page.getByText('Go Offline').first()
    await offlineBtn.click()
    await expect(page.getByText('Offline — changes queue locally').first()).toBeVisible()
  })
})
