export function exactText(value) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^\\s*${escaped}\\s*$`, 'i')
}

export async function installCursor(page, id = 'catatmd-demo-cursor') {
  await page.addInitScript((cursorId) => {
    const attach = () => {
      if (document.getElementById(cursorId)) return
      const style = document.createElement('style')
      style.textContent = `
        #${cursorId} {
          position: fixed;
          top: 0;
          left: 0;
          z-index: 2147483647;
          width: 22px;
          height: 22px;
          border: 2px solid rgba(18, 24, 31, 0.92);
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.7);
          box-shadow: 0 1px 4px rgba(18, 24, 31, 0.24);
          pointer-events: none;
          transform: translate(-50%, -50%);
          transition: width 120ms ease, height 120ms ease, background 120ms ease;
        }
        #${cursorId}[data-down='true'] {
          width: 16px;
          height: 16px;
          background: rgba(18, 24, 31, 0.28);
        }
      `
      const cursor = document.createElement('div')
      cursor.id = cursorId
      document.head.append(style)
      document.body.append(cursor)
      document.addEventListener('mousemove', (event) => {
        cursor.style.left = `${event.clientX}px`
        cursor.style.top = `${event.clientY}px`
      })
      document.addEventListener('mousedown', () => {
        cursor.dataset.down = 'true'
      })
      document.addEventListener('mouseup', () => {
        delete cursor.dataset.down
      })
    }

    if (document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded', attach, { once: true })
    else attach()
  }, id)
}

export async function centerOf(locator, scroll = true) {
  if (scroll) await locator.first().scrollIntoViewIfNeeded()
  const box = await locator.first().boundingBox()
  if (!box) throw new Error('target has no bounding box')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

export function makeTooling(page, { cursor = true, timeout = 30_000 } = {}) {
  const pointer = { x: 1300, y: 820 }

  const pause = (ms) => page.waitForTimeout(ms)

  const must = async (locator, name) => {
    try {
      await locator.first().waitFor({ state: 'visible', timeout })
    } catch {
      throw new Error(`required recording anchor is absent: ${name}`)
    }
    return locator
  }

  const moveTo = async (locator, duration = 480) => {
    const target = await centerOf(locator)
    const steps = Math.max(1, Math.round(duration / 24))
    const origin = pointer
    for (let step = 1; step <= steps; step += 1) {
      const ratio = step / steps
      const eased = ratio < 0.5 ? 2 * ratio * ratio : 1 - (-2 * ratio + 2) ** 2 / 2
      const x = origin.x + (target.x - origin.x) * eased
      const y = origin.y + (target.y - origin.y) * eased
      await page.mouse.move(x, y)
      await pause(24)
    }
    pointer.x = target.x
    pointer.y = target.y
  }

  const click = async (locator, after = 450) => {
    await moveTo(locator)
    await pause(320)
    await page.mouse.down()
    await pause(110)
    await page.mouse.up()
    await pause(after)
  }

  const type = async (locator, text) => {
    await click(locator, 250)
    await page.keyboard.type(text, { delay: 70 })
    await pause(500)
  }

  const fill = async (locator, text, after = 450) => {
    await click(locator, 250)
    await locator.fill(text)
    await pause(after)
  }

  const scrollTo = async (locator, settleMs = 1_050) => {
    await must(locator, 'scroll target')
    await locator.first().scrollIntoViewIfNeeded()
    await pause(settleMs)
  }

  const onCamera = async (locator) => {
    const box = await locator.boundingBox()
    const viewport = page.viewportSize()
    return Boolean(
      (await locator.isVisible()) &&
        box &&
        viewport &&
        box.width > 0 &&
        box.height > 0 &&
        box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= viewport.width &&
        box.y + box.height <= viewport.height,
    )
  }
  const countOf = (selector) => page.locator(selector).count()

  return {
    pointer,
    must,
    moveTo,
    click,
    type,
    fill,
    scrollTo,
    pause,
    onCamera,
    countOf,
    installCursor: cursor ? installCursor : null,
  }
}
