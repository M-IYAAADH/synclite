# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: demo.spec.ts >> Demo app — real-time sync >> going offline shows offline badge
- Location: tests/demo.spec.ts:38:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Offline — changes queue locally').first()
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByText('Offline — changes queue locally').first()

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - banner [ref=e3]:
      - generic [ref=e4]:
        - generic [ref=e5]:
          - generic [ref=e6]: NexSync
          - generic [ref=e7]: Demo
        - link "GitHub →" [ref=e8] [cursor=pointer]:
          - /url: https://github.com/M-IYAAADH/NexSync
    - generic [ref=e10]:
      - heading "Two windows. One relay. Zero config." [level=1] [ref=e11]
      - paragraph [ref=e12]: Type in either window — changes appear instantly in the other. Hit ✈️ Go Offline to queue writes locally, then ⚡ Go Online to sync — nothing is lost.
      - paragraph [ref=e13]:
        - text: "Relay:"
        - code [ref=e14]: ws://localhost:8080
    - main [ref=e15]:
      - generic [ref=e16]:
        - generic [ref=e17]:
          - generic [ref=e18]:
            - generic [ref=e21]: Window A
            - generic [ref=e22]:
              - generic [ref=e26]: Offline
              - button "✈️ Go Offline" [ref=e27] [cursor=pointer]
          - textbox "Start typing… changes appear in the other window in real time." [ref=e29]
          - generic [ref=e31]: 0 chars
        - generic [ref=e32]:
          - generic [ref=e33]:
            - generic [ref=e36]: Window B
            - generic [ref=e37]:
              - generic [ref=e41]: Offline
              - button "✈️ Go Offline" [ref=e42] [cursor=pointer]
          - textbox "Start typing… changes appear in the other window in real time." [ref=e44]
          - generic [ref=e46]: 0 chars
    - contentinfo [ref=e47]:
      - generic [ref=e48]:
        - heading "How it works" [level=2] [ref=e49]
        - generic [ref=e50]:
          - generic [ref=e51]:
            - generic [ref=e52]:
              - generic [ref=e53]: "1"
              - generic [ref=e54]: Instant local writes
            - paragraph [ref=e55]: Every keystroke writes to IndexedDB immediately — no waiting for the network.
          - generic [ref=e56]:
            - generic [ref=e57]:
              - generic [ref=e58]: "2"
              - generic [ref=e59]: Relay broadcasts
            - paragraph [ref=e60]: The relay receives the op, stores it, and fans it out to all connected windows in the same app.
          - generic [ref=e61]:
            - generic [ref=e62]:
              - generic [ref=e63]: "3"
              - generic [ref=e64]: Offline queue
            - paragraph [ref=e65]: While offline, writes queue locally. On reconnect they flush in order, and conflicts resolve via Last-Write-Wins.
        - paragraph [ref=e66]:
          - text: Built with
          - link "@nexsync/react" [ref=e67] [cursor=pointer]:
            - /url: https://github.com/M-IYAAADH/NexSync
          - text: · MIT License
  - alert [ref=e68]
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test'
  2  | 
  3  | test.describe('Demo app — real-time sync', () => {
  4  |   test('page loads with two panels', async ({ page }) => {
  5  |     await page.goto('/')
  6  |     await expect(page.getByText('Window A')).toBeVisible()
  7  |     await expect(page.getByText('Window B')).toBeVisible()
  8  |   })
  9  | 
  10 |   test('typing in Panel A syncs to Panel B', async ({ context }) => {
  11 |     test.setTimeout(30_000)
  12 |     const pageA = await context.newPage()
  13 |     const pageB = await context.newPage()
  14 | 
  15 |     await pageA.goto('/')
  16 |     await pageB.goto('/')
  17 | 
  18 |     // Wait for both to connect
  19 |     await pageA.waitForTimeout(1500)
  20 | 
  21 |     const textareaA = pageA.locator('textarea').first()
  22 |     const textareaB = pageB.locator('textarea').first()
  23 | 
  24 |     await textareaA.fill('hello from panel A')
  25 | 
  26 |     // Allow sync time
  27 |     await pageB.waitForTimeout(2000)
  28 | 
  29 |     const valueB = await textareaB.inputValue()
  30 |     expect(valueB).toContain('hello')
  31 |   })
  32 | 
  33 |   test('offline toggle button exists', async ({ page }) => {
  34 |     await page.goto('/')
  35 |     await expect(page.getByText('Go Offline').first()).toBeVisible()
  36 |   })
  37 | 
  38 |   test('going offline shows offline badge', async ({ page }) => {
  39 |     await page.goto('/')
  40 |     await page.waitForTimeout(500)
  41 |     const offlineBtn = page.getByText('Go Offline').first()
  42 |     await offlineBtn.click()
> 43 |     await expect(page.getByText('Offline — changes queue locally').first()).toBeVisible()
     |                                                                             ^ Error: expect(locator).toBeVisible() failed
  44 |   })
  45 | })
  46 | 
```