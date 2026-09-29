import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { defaultSettings, SETTINGS_KEY } from '../src/lib/settings'

async function numberField(page: Page, label: string, value: number) {
  const input = page.getByRole('spinbutton', { name: label, exact: true })
  await input.fill(String(value))
  await input.press('Tab')
  await expect(input).toHaveValue(String(value))
}

async function uploadColorImage(page: Page, type = 'image/png') {
  const base64 = await page.evaluate((mimeType) => {
    const canvas = document.createElement('canvas')
    canvas.width = 1000
    canvas.height = 250
    const context = canvas.getContext('2d')!
    context.fillStyle = '#ff0000'
    context.fillRect(0, 0, 500, 250)
    context.fillStyle = '#0000ff'
    context.fillRect(500, 0, 500, 250)
    return canvas.toDataURL(mimeType).split(',')[1]!
  }, type)
  await page.getByTestId('image-input').setInputFiles({ name: type === 'image/png' ? 'color-test.png' : 'color-test.jpg', mimeType: type, buffer: Buffer.from(base64, 'base64') })
  await expect(page.getByRole('button', { name: /Export wallpapers/ })).toBeEnabled()
}

async function pixelAt(page: Page, index: number, x: number, y: number) {
  const url = await page.getByTestId(`download-${index}`).getAttribute('href')
  return page.evaluate(async ({ url, x, y }) => {
    const bitmap = await createImageBitmap(await (await fetch(url!)).blob())
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')!
    context.drawImage(bitmap, 0, 0)
    const pixel = Array.from(context.getImageData(x, y, 1, 1).data)
    bitmap.close()
    return pixel
  }, { url, x, y })
}

test('ultraviolet daisyUI theme and export modal support keyboard dismissal', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'ultraviolet')
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim().toLowerCase())).toBe('#9400d3')
  await expect(page.locator('.btn-primary')).toHaveCount(1)
  await testInfo.attach('studio-empty', { body: await page.screenshot({ fullPage: true, animations: 'disabled' }), contentType: 'image/png' })
  await page.getByRole('button', { name: 'Or try a sample' }).click()
  const exportButton = page.getByRole('button', { name: /Export wallpapers/ })
  await expect(exportButton).toBeEnabled()
  await expect(exportButton).toHaveCSS('background-color', 'rgb(148, 0, 211)')
  await exportButton.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.locator('.modal-box')).toBeVisible()
  await testInfo.attach('studio-exports', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
})

test('monitor details, measured size, portrait orientation, and positions persist', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Your desk' })).toBeVisible()
  await expect(page.getByRole('spinbutton', { name: 'Diagonal (in)' })).toHaveValue('27')
  await page.getByRole('checkbox', { name: 'Use measured active area' }).check()
  await numberField(page, 'Active width (mm)', 600)
  await numberField(page, 'Active height (mm)', 340)
  await page.getByLabel('Orientation').selectOption('90')
  await numberField(page, 'Position X (mm)', -40)
  await numberField(page, 'Position Y (mm)', -25)
  await expect(page.getByTestId('output-chip').first()).toContainText('1080 × 1920')
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').monitors?.[0]?.x, SETTINGS_KEY)).toBe(-40)
  await page.reload()
  await expect(page.getByRole('spinbutton', { name: 'Active width (mm)' })).toHaveValue('600')
  await expect(page.getByLabel('Orientation')).toHaveValue('90')
  await expect(page.getByRole('spinbutton', { name: 'Position Y (mm)' })).toHaveValue('-25')
  await page.getByRole('button', { name: 'Add a screen', exact: true }).click()
  await expect(page.getByTestId('monitor-row')).toHaveCount(3)
  await page.getByRole('button', { name: 'Remove screen 3', exact: true }).click()
  await expect(page.getByTestId('monitor-row')).toHaveCount(2)
})

test('monitors can be dragged and nudged without snapping locking movement', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('checkbox', { name: 'Snap to guides' }).uncheck()
  const monitor = page.getByTestId('layout-monitor-1')
  const box = (await monitor.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 35, box.y + box.height / 2 + 15, { steps: 8 })
  await page.mouse.up()
  const input = page.getByRole('spinbutton', { name: 'Position X (mm)' })
  const before = Number(await input.inputValue())
  expect(before).toBeGreaterThan(20)
  await monitor.focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => Number(await input.inputValue())).toBeCloseTo(before + 1, 1)
})

test('sample preview, image positioning, independent view zoom, and native PNG downloads', async ({ page }, testInfo) => {
  const errors: string[] = []
  const workers: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('worker', (worker) => workers.push(worker.url()))
  await page.goto('/')
  await expect(page.getByRole('button', { name: /Export wallpapers/ })).toBeDisabled()
  await page.getByRole('button', { name: 'Or try a sample' }).click()
  await expect(page.getByTestId('image-name')).toHaveText('afterglow-sample.png')
  await expect(page.getByRole('button', { name: /Export wallpapers/ })).toBeEnabled()
  const image = page.getByTestId('wallpaper-composer').locator('image').first()
  const previewSize = await image.evaluate(async (element) => {
    const image = new Image()
    image.src = element.getAttribute('href')!
    await image.decode()
    return image.naturalWidth
  })
  expect(previewSize).toBe(2048)
  await numberField(page, 'Image scale percent', 130)
  await page.getByRole('button', { name: 'Align image left', exact: true }).click()
  const left = Number(await image.getAttribute('x'))
  await page.getByRole('button', { name: 'Align image right', exact: true }).click()
  expect(Number(await image.getAttribute('x'))).toBeLessThan(left)
  await page.getByRole('button', { name: 'Zoom editor view out' }).click()
  await expect(page.getByRole('spinbutton', { name: 'Image scale percent' })).toHaveValue('130')
  const canvas = page.getByTestId('wallpaper-composer')
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, 120)
  await expect.poll(async () => Number(await page.getByRole('spinbutton', { name: 'Image scale percent' }).inputValue())).toBeLessThan(130)
  await page.getByRole('checkbox', { name: 'Snap to guides' }).uncheck()
  const startX = Number(await image.getAttribute('x'))
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
  expect(Number(await image.getAttribute('x'))).toBeGreaterThan(startX)
  await page.getByRole('button', { name: 'Cover layout', exact: true }).click()
  await testInfo.attach('studio-desktop', { body: await page.screenshot({ fullPage: true, animations: 'disabled' }), contentType: 'image/png' })
  await page.getByRole('button', { name: /Export wallpapers/ }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  const sizes = [[1920, 1080], [3440, 1440]]
  for (const [index, size] of sizes.entries()) {
    const downloadEvent = page.waitForEvent('download')
    await page.getByTestId(`download-${index}`).click()
    const download = await downloadEvent
    const data = await readFile((await download.path())!)
    expect(data.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    expect([data.readUInt32BE(16), data.readUInt32BE(20)]).toEqual(size)
    expect(download.suggestedFilename()).toMatch(/\.png$/)
  }
  expect(workers.length).toBeGreaterThanOrEqual(2)
  expect(errors).toEqual([])
  await page.getByRole('button', { name: 'Back to composing' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
})

test('mixed-DPI crops sample the same physical plane and fill uncovered background', async ({ page }) => {
  const settings = defaultSettings()
  settings.monitors = settings.monitors.map((monitor, index) => ({ ...monitor, x: index * 500, y: 0, physicalWidthMm: 500, physicalHeightMm: 250, widthPx: index === 0 ? 200 : 400, heightPx: index === 0 ? 100 : 200 }))
  await page.addInitScript(({ key, settings }) => localStorage.setItem(key, JSON.stringify(settings)), { key: SETTINGS_KEY, settings })
  await page.goto('/')
  await uploadColorImage(page)
  await page.getByRole('button', { name: /Export wallpapers/ }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(await pixelAt(page, 0, 100, 50)).toEqual([255, 0, 0, 255])
  expect(await pixelAt(page, 1, 200, 100)).toEqual([0, 0, 255, 255])
  await page.getByRole('button', { name: 'Back to composing' }).click()
  await numberField(page, 'Image scale percent', 50)
  await expect(page.getByTestId('quality-note').first()).toContainText('Background is visible on 2 screens')
  await page.getByRole('button', { name: /Export wallpapers/ }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(await pixelAt(page, 0, 1, 1)).toEqual([17, 22, 29, 255])
  expect(await pixelAt(page, 1, 398, 198)).toEqual([17, 22, 29, 255])
})

test('JPEG works without workers and unsupported files preserve the current image', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'Worker', { value: undefined, configurable: true }) })
  await page.goto('/')
  await uploadColorImage(page, 'image/jpeg')
  await expect(page.getByTestId('image-name')).toHaveText('color-test.jpg')
  await page.getByTestId('image-input').setInputFiles({ name: 'unsafe.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>window.svgRan = true</script></svg>') })
  await expect(page.getByRole('alert')).toContainText(/JPEG|PNG/)
  await expect(page.getByTestId('image-name')).toHaveText('color-test.jpg')
  expect(await page.evaluate(() => 'svgRan' in window)).toBe(false)
  await page.getByRole('button', { name: /Export wallpapers/ }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('pending form edits stay attached to their screen and survive starting a drag', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('spinbutton', { name: 'Native width (px)' }).fill('2560')
  await page.getByTestId('layout-monitor-2').click()
  await expect(page.getByRole('spinbutton', { name: 'Native width (px)' })).toHaveValue('3440')
  await page.getByRole('button', { name: 'Configure screen 1: Full HD' }).click()
  await expect(page.getByRole('spinbutton', { name: 'Native width (px)' })).toHaveValue('2560')
  await page.getByRole('button', { name: 'Or try a sample' }).click()
  const scale = page.getByRole('spinbutton', { name: 'Image scale percent' })
  await expect(scale).toBeEnabled()
  await scale.fill('150')
  const box = (await page.getByTestId('wallpaper-composer').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()
  await expect(scale).toHaveValue('150')
})

test('add and align cannot invalidate saved layouts at coordinate limits', async ({ page }) => {
  await page.goto('/')
  await numberField(page, 'Position X (mm)', 10000)
  await page.getByRole('button', { name: 'Add a screen', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('beyond ±10,000 mm')
  await expect(page.getByTestId('monitor-row')).toHaveCount(2)
  await numberField(page, 'Position Y (mm)', 10000)
  await page.getByRole('button', { name: 'Align monitor bottoms' }).click()
  await expect(page.getByRole('alert')).toContainText('beyond ±10,000 mm')
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').monitors?.[0]?.y, SETTINGS_KEY)).toBe(10000)
  await page.reload()
  await expect(page.getByRole('spinbutton', { name: 'Position Y (mm)' })).toHaveValue('10000')
})

test('EXIF-oriented JPEGs retain the correct crop and portrait output dimensions', async ({ page }) => {
  const settings = defaultSettings()
  settings.monitors = [{ ...settings.monitors[0]!, widthPx: 1000, heightPx: 250, physicalWidthMm: 1000, physicalHeightMm: 250, rotation: 90 }]
  await page.addInitScript(({ key, settings }) => localStorage.setItem(key, JSON.stringify(settings)), { key: SETTINGS_KEY, settings })
  await page.goto('/')
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 1000
    canvas.height = 250
    const context = canvas.getContext('2d')!
    context.fillStyle = '#ff0000'
    context.fillRect(0, 0, 500, 250)
    context.fillStyle = '#0000ff'
    context.fillRect(500, 0, 500, 250)
    return canvas.toDataURL('image/jpeg', 0.95).split(',')[1]!
  })
  const jpeg = Buffer.from(base64, 'base64')
  // APP1 / little-endian TIFF: one EXIF orientation tag, value 6 (90 degrees clockwise).
  const exif = Buffer.alloc(36)
  exif[0] = 0xff
  exif[1] = 0xe1
  exif.writeUInt16BE(34, 2)
  exif.write('Exif\0\0', 4)
  exif.write('II', 10)
  exif.writeUInt16LE(42, 12)
  exif.writeUInt32LE(8, 14)
  exif.writeUInt16LE(1, 18)
  exif.writeUInt16LE(0x0112, 20)
  exif.writeUInt16LE(3, 22)
  exif.writeUInt32LE(1, 24)
  exif.writeUInt16LE(6, 28)
  await page.getByTestId('image-input').setInputFiles({ name: 'rotated.jpg', mimeType: 'image/jpeg', buffer: Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)]) })
  await expect(page.getByTestId('image-dimensions')).toContainText('250 × 1,000')
  await page.getByRole('button', { name: /Export wallpapers/ }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByTestId('download-0')).toContainText('250 × 1000')
  const top = await pixelAt(page, 0, 125, 250)
  const bottom = await pixelAt(page, 0, 125, 750)
  expect(top[0]).toBeGreaterThan(250)
  expect(top[2]).toBeLessThan(5)
  expect(bottom[2]).toBeGreaterThan(250)
  expect(bottom[0]).toBeLessThan(5)
})

test('mobile layout fits the viewport and can compose a wallpaper', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Or try a sample' }).click()
  await expect(page.getByTestId('image-name')).toHaveText('afterglow-sample.png')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await testInfo.attach('studio-mobile', { body: await page.screenshot({ fullPage: true, animations: 'disabled' }), contentType: 'image/png' })
})
