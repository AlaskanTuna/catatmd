// Standalone still renderer; durations are metadata, not playback or narration timing.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const output = process.env.DEMO_DIR
const source = process.env.DEMO_SLIDES_DIR
const spec = process.env.DEMO_SLIDES
if (!output || !source || !spec) {
  throw new Error('Set DEMO_DIR, DEMO_SLIDES_DIR and DEMO_SLIDES (name:duration_ms pairs)')
}
if (existsSync(output)) throw new Error('DEMO_DIR must be a new directory')
const slides = spec
  .trim()
  .split(/\s+/)
  .map((pair) => {
    const match = /^([a-zA-Z0-9_-]+):(\d+)$/.exec(pair)
    if (!match || !Number.isSafeInteger(Number(match[2])) || Number(match[2]) <= 0) {
      throw new Error('Each slide needs a safe name and positive integer duration_ms')
    }
    if (!existsSync(join(source, `${match[1]}.html`))) throw new Error('Slide HTML missing')
    return { name: match[1], duration_ms: Number(match[2]) }
  })
if (new Set(slides.map((slide) => slide.name)).size !== slides.length) {
  throw new Error('Duplicate slide names')
}
mkdirSync(output, { recursive: true })
const { chromium } = await import(process.env.DEMO_PLAYWRIGHT ?? 'playwright')
const browser = await chromium.launch()
try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  })
  for (const [index, slide] of slides.entries()) {
    await page.goto(pathToFileURL(join(source, `${slide.name}.html`)).href, {
      waitUntil: 'domcontentloaded',
    })
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(400)
    const valid = await page.evaluate(() => {
      if (document.body.innerText.trim().length < 40) return false
      return [...document.querySelectorAll('body *')].every((element) => {
        if (!element.textContent.trim() && !element.querySelector('svg, rect')) return true
        return element.getBoundingClientRect().bottom <= 852
      })
    })
    if (!valid) throw new Error('Slide is empty or overlaps the subtitle band')
    await page.screenshot({ path: join(output, `slide-${index + 1}.png`), animations: 'disabled' })
  }
  writeFileSync(join(output, 'slide-plan.json'), `${JSON.stringify(slides, null, 2)}\n`)
} finally {
  await browser.close()
}
