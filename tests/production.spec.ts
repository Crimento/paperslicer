import { expect, test } from '@playwright/test'

test('built app and worker load from a GitHub Pages-style subpath without external requests', async ({ page }) => {
  const errors: string[] = []
  const workers: string[] = []
  const externalRequests: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('worker', (worker) => workers.push(worker.url()))
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.protocol.startsWith('http') && url.hostname !== '127.0.0.1') externalRequests.push(url.href)
  })
  await page.goto('/paperslicer/')
  await expect(page.getByRole('heading', { name: 'Your wallpaper' })).toBeVisible()
  const favicon = page.locator('link[rel="icon"]')
  await expect(favicon).toHaveAttribute('type', 'image/svg+xml')
  await expect(favicon).toHaveAttribute('sizes', 'any')
  const faviconUrl = await favicon.evaluate((link) => (link as HTMLLinkElement).href)
  expect(new URL(faviconUrl).pathname).toBe('/paperslicer/favicon.svg')
  const faviconResponse = await page.request.get(faviconUrl)
  expect(faviconResponse.ok()).toBe(true)
  expect(faviconResponse.headers()['content-type']).toContain('image/svg+xml')
  const brandPath = await page.getByRole('link', { name: 'Paperslicer home' }).locator('svg path').getAttribute('d')
  expect(await faviconResponse.text()).toContain(`d="${brandPath}"`)
  await page.getByRole('button', { name: 'Or try a sample' }).click()
  await expect(page.getByTestId('image-name')).toHaveText('afterglow-sample.png')
  const exportButton = page.getByRole('button', { name: /Export wallpapers/ })
  await expect(exportButton).toHaveCSS('background-color', 'rgb(148, 0, 211)')
  await exportButton.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByTestId('download-0')).toContainText('1920 × 1080')
  await expect(page.getByTestId('download-1')).toContainText('3440 × 1440')
  expect(workers.length).toBe(2)
  expect(workers.every((url) => url.includes('/paperslicer/assets/image.worker-'))).toBe(true)
  expect(errors).toEqual([])
  expect(externalRequests).toEqual([])
})
