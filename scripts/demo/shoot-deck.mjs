// Captures each slide of an operator-supplied HTML deck as a still. This is an optional path for
// slides-only films; the default demo pipeline does not need a deck.

import { existsSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const deck = process.env.DECK_HTML
const outDir = process.env.DECK_SHOTS
if (!deck || !outDir) {
  console.error('set DECK_HTML and DECK_SHOTS')
  process.exit(1)
}
if (existsSync(outDir)) throw new Error('DECK_SHOTS must be a new directory')
mkdirSync(outDir, { recursive: true })

const settle = Number(process.env.DECK_SETTLE_MS ?? 1400)

const { chromium } = await import(process.env.DEMO_PLAYWRIGHT ?? 'playwright')
const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  reducedMotion: 'no-preference',
})
const page = await context.newPage()
await page.goto(pathToFileURL(deck).href, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => document.fonts.ready)

const count = await page.locator('section.slide').count()
if (count === 0) {
  await browser.close()
  throw new Error('deck has no section.slide elements')
}
process.stderr.write(`deck slides: ${count}\n`)

for (let index = 0; index < count; index += 1) {
  await page.waitForTimeout(settle)
  const active = await page.evaluate(() =>
    [...document.querySelectorAll('section.slide')].findIndex((el) =>
      el.classList.contains('active'),
    ),
  )
  if (active !== index) throw new Error(`expected slide ${index + 1} active, found ${active + 1}`)
  const name = `slide-${index + 1}`
  await page.screenshot({ path: `${outDir}/${name}.png`, animations: 'disabled' })
  process.stderr.write(`  captured ${name}\n`)
  if (index < count - 1) await page.keyboard.press('ArrowRight')
}

await context.close()
await browser.close()
process.stdout.write(`${count}\n`)
