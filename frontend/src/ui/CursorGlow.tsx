import { useEffect, useRef } from 'react'

/**
 * A soft trail behind the pointer, on the public pages only.
 *
 * Each disc chases the one ahead of it rather than the cursor, which is what
 * bends the chain along the path actually travelled instead of sliding it
 * straight toward the pointer as one lagging blob. Discs shrink and fade
 * toward the tail so the end dissolves rather than stopping.
 *
 * It is deliberately absent from the signed-in app. A decoration that follows
 * the cursor across a screen where a doctor is reading red flags and editing a
 * clinical note is competing for exactly the attention that screen needs, and
 * `docs/DESIGN.md` reserves movement there for things that changed. Marketing
 * is the one surface where delight is the job.
 *
 * Position is written with `transform` and never through React state: at
 * pointer rates a re-render per move would rebuild a subtree for a decoration.
 */

const TRAIL = 14
const HEAD_SIZE = 190
const TAIL_SIZE = 34
const HEAD_ALPHA = 0.04
/** How hard each disc chases the one ahead. Lower is a longer, lazier tail. */
const CHASE = 0.3

/*
 * No `prefers-reduced-motion` branch here, matching the reasoning already
 * written into index.css: the preference suppresses motion the interface
 * starts on its own. This chain moves only where the pointer has just been and
 * stops dead when the pointer does, which puts it in the same category as a
 * hover highlight rather than as looping decoration.
 */

/*
 * The discs overlap heavily near the head and alpha compounds where they do,
 * so the head constant sits well below what one disc alone would need. Judge
 * this by the rendered result, not by the constant.
 */
const sizeAt = (index: number) => HEAD_SIZE - (HEAD_SIZE - TAIL_SIZE) * (index / (TRAIL - 1))
const alphaAt = (index: number) => HEAD_ALPHA * (1 - index / (TRAIL - 1)) ** 1.9

/* Position in the chain *is* each disc's identity: the list is a fixed length,
   is never reordered and is never filtered. Naming that here beats reaching for
   the map index at the call site, the same way the transcript turns do. */
const DISCS = Array.from({ length: TRAIL }, (_, index) => ({ key: `disc-${index}`, index }))

/*
 * Two conditions, and they rule out different machines.
 *
 * `any-pointer: fine` drops touch, where a trail would sit wherever the last
 * tap landed. `any-pointer` rather than `pointer`, because a touchscreen laptop
 * reports its *primary* pointer as coarse even with a mouse plugged in and that
 * machine should still get the trail; pure-touch devices report no fine pointer
 * at all.
 *
 * The width test drops the mobile layout, which the pointer test alone cannot
 * see: a narrow window on a desktop is a fine pointer on a phone-shaped page,
 * and the trail is sized for a screen it is not on there. 48rem is Tailwind's
 * `md`, the same line index.css already switches the reveal off at.
 */
const TRAIL_QUERY = '(any-pointer: fine) and (min-width: 48rem)'

export function CursorGlow() {
  const wrap = useRef<HTMLDivElement>(null)
  const dots = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    const node = wrap.current
    if (!node) return

    const media = window.matchMedia(TRAIL_QUERY)
    let teardown: (() => void) | null = null

    const run = () => {
      const target = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
      // Radius rides on the point rather than in a parallel array: the two are
      // read together on every frame and can never be out of step this way.
      const points = Array.from({ length: TRAIL }, (_, index) => ({
        ...target,
        radius: sizeAt(index) / 2,
        dot: dots.current[index],
      }))
      let started = false
      let frame = 0

      for (const [index, point] of points.entries()) {
        if (!point.dot) continue
        point.dot.style.width = `${point.radius * 2}px`
        point.dot.style.height = `${point.radius * 2}px`
        point.dot.style.setProperty('--dot-alpha', alphaAt(index).toFixed(4))
      }

      const onMove = (event: PointerEvent) => {
        target.x = event.clientX
        target.y = event.clientY
        if (started) return
        // Collapse the chain onto the first known position, so it fades in where
        // the pointer is rather than sweeping in from the centre of the screen.
        started = true
        for (const point of points) {
          point.x = target.x
          point.y = target.y
        }
        node.style.opacity = '1'
      }

      // One pass, because the head chasing the pointer and disc N chasing disc
      // N-1 are the same rule: chase whatever is ahead of you. The head's
      // "ahead" is simply the pointer itself.
      const loop = () => {
        let ahead = target
        for (const point of points) {
          point.x += (ahead.x - point.x) * CHASE
          point.y += (ahead.y - point.y) * CHASE
          if (point.dot) {
            point.dot.style.transform = `translate3d(${point.x - point.radius}px, ${point.y - point.radius}px, 0)`
          }
          ahead = point
        }
        frame = requestAnimationFrame(loop)
      }

      window.addEventListener('pointermove', onMove, { passive: true })
      frame = requestAnimationFrame(loop)
      return () => {
        window.removeEventListener('pointermove', onMove)
        cancelAnimationFrame(frame)
      }
    }

    /*
     * Subscribed rather than evaluated once, because the answer changes without
     * a remount: rotating a tablet, dragging a window narrow, or opening the
     * responsive inspector all cross the width line while this component stays
     * mounted. Evaluating at mount alone left the trail running over a mobile
     * layout for as long as the tab stayed open.
     */
    const sync = () => {
      if (media.matches) {
        teardown ??= run()
        return
      }
      teardown?.()
      teardown = null
      // Reset, so the chain is not left frozen mid-screen at whatever position
      // it held when the viewport crossed the line.
      node.style.opacity = '0'
    }

    sync()
    media.addEventListener('change', sync)
    return () => {
      media.removeEventListener('change', sync)
      teardown?.()
    }
  }, [])

  return (
    <div ref={wrap} className="cursor-glow" aria-hidden="true">
      {DISCS.map(({ key, index }) => (
        <div
          key={key}
          ref={(element) => {
            dots.current[index] = element
          }}
          className="cursor-glow-dot"
        />
      ))}
    </div>
  )
}
