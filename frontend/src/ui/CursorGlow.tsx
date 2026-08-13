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

export function CursorGlow() {
  const wrap = useRef<HTMLDivElement>(null)
  const dots = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    const node = wrap.current
    if (!node) return
    // Touch has no hover, so a trail would sit wherever the last tap landed.
    // `any-pointer`, not `pointer`: a touchscreen laptop reports its *primary*
    // pointer as coarse even with a mouse plugged in, and that machine should
    // get the trail. Pure-touch devices report no fine pointer at all.
    if (!window.matchMedia('(any-pointer: fine)').matches) return

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
