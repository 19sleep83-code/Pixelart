// Pixel art for the interface of the next version: command and touch icons, cursors, buttons
// and panels (nine-slice), flags and rank badges. Drawn in code at a small size, snapped to whole
// pixels and outlined, then exported at ×1, ×2 and ×3.

const INK = '#0b0d07'
const LIGHT = '#e8e3cb'
const OLIVE = '#5a6a36'
const OLIVE_D = '#46532b'
const OLIVE_L = '#6a7558'
const BRASS = '#f0c840'
const GREEN = '#8fe060'
const RED = '#ff5a4a'
const BLUE = '#5aa0e8'

type Draw = (c: CanvasRenderingContext2D) => void

function canvas(w: number, h: number) {
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  return cv
}

/** draws, snaps every pixel to solid or clear, then puts a dark outline round the shapes */
function pixel(w: number, h: number, draw: Draw, outline = true): HTMLCanvasElement {
  const cv = canvas(w, h)
  const c = cv.getContext('2d')!
  c.lineWidth = 1.6
  c.lineCap = 'round'
  c.lineJoin = 'round'
  draw(c)
  const img = c.getImageData(0, 0, w, h)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] >= 110) {
      // undo the soft edge: full colour
      const a = d[i + 3] / 255
      d[i] = Math.min(255, Math.round(d[i] / a))
      d[i + 1] = Math.min(255, Math.round(d[i + 1] / a))
      d[i + 2] = Math.min(255, Math.round(d[i + 2] / a))
      d[i + 3] = 255
    } else d[i + 3] = 0
  }
  if (outline) {
    const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] === 255
    const add: number[] = []
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (!solid(x, y) && (solid(x + 1, y) || solid(x - 1, y) || solid(x, y + 1) || solid(x, y - 1))) add.push(y * w + x)
    for (const p of add) {
      d[p * 4] = 0x0b
      d[p * 4 + 1] = 0x0d
      d[p * 4 + 2] = 0x07
      d[p * 4 + 3] = 255
    }
  }
  c.putImageData(img, 0, 0)
  return cv
}

export function scaled(cv: HTMLCanvasElement, k: number): HTMLCanvasElement {
  const out = canvas(cv.width * k, cv.height * k)
  const c = out.getContext('2d')!
  c.imageSmoothingEnabled = false
  c.drawImage(cv, 0, 0, out.width, out.height)
  return out
}

// ─────────────────────────────────────────────────────────── shapes

const poly = (c: CanvasRenderingContext2D, pts: number[], fill: string) => {
  c.beginPath()
  c.moveTo(pts[0], pts[1])
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1])
  c.closePath()
  c.fillStyle = fill
  c.fill()
}
const line = (c: CanvasRenderingContext2D, pts: number[], col: string, w = 1.6) => {
  c.beginPath()
  c.moveTo(pts[0], pts[1])
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1])
  c.strokeStyle = col
  c.lineWidth = w
  c.stroke()
}
const circle = (c: CanvasRenderingContext2D, x: number, y: number, r: number, col: string, fill = false, w = 1.6) => {
  c.beginPath()
  c.arc(x, y, r, 0, Math.PI * 2)
  if (fill) {
    c.fillStyle = col
    c.fill()
  } else {
    c.strokeStyle = col
    c.lineWidth = w
    c.stroke()
  }
}
const rect = (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string) => {
  c.fillStyle = col
  c.fillRect(x, y, w, h)
}
const arrow = (c: CanvasRenderingContext2D, col: string) => poly(c, [2, 7, 9, 7, 9, 3, 14, 8, 9, 13, 9, 9, 2, 9], col)

// ─────────────────────────────────────────────────────────── command icons (16 × 16)

export const ICONS: Record<string, { name: string; draw: Draw }> = {
  move: { name: 'Bewegen', draw: (c) => arrow(c, LIGHT) },
  attack: {
    name: 'Angreifen',
    draw: (c) => {
      circle(c, 8, 8, 5, RED)
      line(c, [8, 1, 8, 5], RED)
      line(c, [8, 11, 8, 15], RED)
      line(c, [1, 8, 5, 8], RED)
      line(c, [11, 8, 15, 8], RED)
    },
  },
  attack_move: {
    name: 'Angriffsbewegung',
    draw: (c) => {
      arrow(c, LIGHT)
      circle(c, 12, 4, 2.3, RED, true)
    },
  },
  stop: {
    name: 'Stopp',
    draw: (c) => {
      poly(c, [5, 1.5, 11, 1.5, 14.5, 5, 14.5, 11, 11, 14.5, 5, 14.5, 1.5, 11, 1.5, 5], RED)
      rect(c, 4, 7, 8, 2, LIGHT)
    },
  },
  guard: {
    name: 'Stellung halten',
    draw: (c) => {
      poly(c, [8, 1.5, 14, 4, 13, 10, 8, 14.5, 3, 10, 2, 4], OLIVE_L)
      poly(c, [8, 4, 11.5, 5.5, 11, 9.5, 8, 12, 5, 9.5, 4.5, 5.5], LIGHT)
    },
  },
  harvest: {
    name: 'Erz abbauen',
    draw: (c) => {
      poly(c, [8, 2, 13, 7, 8, 14, 3, 7], BRASS)
      poly(c, [8, 2, 10, 7, 8, 14, 6, 7], '#fff6d8')
    },
  },
  return: {
    name: 'Zum Depot',
    draw: (c) => {
      c.beginPath()
      c.arc(8, 9, 5, Math.PI * 1.05, Math.PI * 2.1)
      c.strokeStyle = LIGHT
      c.lineWidth = 2
      c.stroke()
      poly(c, [0.5, 8, 6, 8, 3.2, 12.5], LIGHT)
      rect(c, 11, 11, 4, 4, BRASS)
    },
  },
  garrison: {
    name: 'Haus besetzen',
    draw: (c) => {
      poly(c, [2, 7, 8, 2, 14, 7, 14, 14, 2, 14], OLIVE_L)
      poly(c, [3, 7, 8, 3, 13, 7], '#c06040')
      poly(c, [4, 10, 8, 10, 8, 8, 11, 11, 8, 14, 8, 12, 4, 12], GREEN)
    },
  },
  exit: {
    name: 'Räumen',
    draw: (c) => {
      rect(c, 2, 2, 7, 12, OLIVE_L)
      rect(c, 4, 4, 3, 8, INK)
      poly(c, [6, 7, 10, 7, 10, 4.5, 14.5, 8, 10, 11.5, 10, 9, 6, 9], LIGHT)
    },
  },
  capture: {
    name: 'Erobern',
    draw: (c) => {
      rect(c, 3, 2, 1.6, 13, LIGHT)
      poly(c, [4.5, 2, 13.5, 4.5, 4.5, 8], BRASS)
      rect(c, 1, 13, 7, 2, OLIVE_L)
    },
  },
  sell: {
    name: 'Verkaufen',
    draw: (c) => {
      // a stack of coins
      for (const y of [12, 9, 6]) {
        rect(c, 3, y, 10, 2.4, '#b8962e')
        rect(c, 3, y, 10, 1, BRASS)
      }
      c.beginPath()
      c.ellipse(8, 5, 5, 2.2, 0, 0, Math.PI * 2)
      c.fillStyle = '#fff6d8'
      c.fill()
    },
  },
  repair: {
    name: 'Reparieren',
    draw: (c) => {
      line(c, [4, 12, 10, 6], LIGHT, 2.4)
      circle(c, 11, 5, 3.2, LIGHT, true)
      poly(c, [11, 2, 15, 2, 15, 5, 12.5, 5], 'rgba(0,0,0,0)')
      c.clearRect(11, 2, 3, 3)
      circle(c, 3.5, 12.5, 1.4, LIGHT, true)
    },
  },
  unload: {
    name: 'Entladen',
    draw: (c) => {
      poly(c, [6, 1.5, 10, 1.5, 10, 7, 13, 7, 8, 12, 3, 7, 6, 7], LIGHT)
      rect(c, 2, 13, 12, 2, BLUE)
    },
  },
  board: {
    name: 'Einsteigen',
    draw: (c) => {
      poly(c, [2, 10, 14, 10, 12, 14, 4, 14], BLUE)
      poly(c, [6, 9, 10, 9, 10, 5, 13, 5, 8, 0.5, 3, 5, 6, 5], LIGHT)
    },
  },
  rally: {
    name: 'Sammelpunkt',
    draw: (c) => {
      circle(c, 8, 6, 4.5, GREEN, true)
      poly(c, [4.2, 8, 11.8, 8, 8, 15], GREEN)
      circle(c, 8, 6, 1.8, INK, true)
    },
  },
  primary: {
    name: 'Hauptgebäude',
    draw: (c) => {
      const pts: number[] = []
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 2.8 : 6.5
        pts.push(8 + Math.cos(a) * r, 8.5 + Math.sin(a) * r)
      }
      poly(c, pts, BRASS)
    },
  },
  box_select: {
    name: 'Rahmen ziehen (Touch)',
    draw: (c) => {
      for (let i = 1; i < 14; i += 3) {
        rect(c, i, 1, 2, 1.4, LIGHT)
        rect(c, i, 12.6, 2, 1.4, LIGHT)
        rect(c, 1, i, 1.4, 2, LIGHT)
        rect(c, 12.6, i, 1.4, 2, LIGHT)
      }
      poly(c, [8, 6, 8, 15, 10.2, 12.8, 12, 15.5, 13.5, 14.7, 11.8, 12.2, 14.8, 11.8], GREEN)
    },
  },
  deselect: {
    name: 'Abwählen',
    draw: (c) => {
      line(c, [3, 3, 13, 13], LIGHT, 2.4)
      line(c, [13, 3, 3, 13], LIGHT, 2.4)
    },
  },
  zoom_in: {
    name: 'Hineinzoomen',
    draw: (c) => {
      circle(c, 6.5, 6.5, 4.5, LIGHT)
      line(c, [10, 10, 14, 14], LIGHT, 2.4)
      rect(c, 4.5, 6, 4, 1.2, LIGHT)
      rect(c, 6, 4.5, 1.2, 4, LIGHT)
    },
  },
  zoom_out: {
    name: 'Herauszoomen',
    draw: (c) => {
      circle(c, 6.5, 6.5, 4.5, LIGHT)
      line(c, [10, 10, 14, 14], LIGHT, 2.4)
      rect(c, 4.5, 6, 4, 1.2, LIGHT)
    },
  },
  menu: {
    name: 'Menü / Pause',
    draw: (c) => {
      rect(c, 4, 3, 3, 10, LIGHT)
      rect(c, 9, 3, 3, 10, LIGHT)
    },
  },
  build: {
    name: 'Bauen',
    draw: (c) => {
      poly(c, [2, 14, 2, 8, 8, 4, 14, 8, 14, 14], OLIVE_L)
      rect(c, 6, 9, 4, 5, INK)
      line(c, [9, 1, 14, 6], BRASS, 2)
    },
  },
  power: {
    name: 'Strom',
    draw: (c) => poly(c, [9, 1, 3, 9, 7.5, 9, 6, 15, 13, 6.5, 8.5, 6.5, 10.5, 1], BRASS),
  },
  credits: {
    name: 'Credits',
    draw: (c) => {
      poly(c, [4, 3, 12, 3, 14, 7, 8, 14, 2, 7], BRASS)
      poly(c, [4, 3, 8, 7, 12, 3], '#fff6d8')
      line(c, [2, 7, 14, 7], '#d8bf5c', 1)
    },
  },
}

// ─────────────────────────────────────────────────────────── cursors (16 × 16, hotspot)

export const CURSORS: Record<string, { name: string; hot: [number, number]; draw: Draw }> = {
  pointer: { name: 'Zeiger', hot: [1, 1], draw: (c) => poly(c, [1, 1, 1, 12, 4, 9.5, 6.5, 14.5, 8.5, 13.5, 6, 8.5, 10, 8.5], LIGHT) },
  select: {
    name: 'Auswählen',
    hot: [8, 8],
    draw: (c) => {
      for (const [x, y, dx, dy] of [[2, 2, 1, 1], [14, 2, -1, 1], [2, 14, 1, -1], [14, 14, -1, -1]]) {
        rect(c, Math.min(x, x + dx * 4), y, 4, 1.4, GREEN)
        rect(c, x, Math.min(y, y + dy * 4), 1.4, 4, GREEN)
      }
    },
  },
  move: {
    name: 'Bewegen',
    hot: [8, 8],
    draw: (c) => {
      poly(c, [8, 1, 11, 4.5, 5, 4.5], GREEN)
      poly(c, [8, 15, 11, 11.5, 5, 11.5], GREEN)
      poly(c, [1, 8, 4.5, 5, 4.5, 11], GREEN)
      poly(c, [15, 8, 11.5, 5, 11.5, 11], GREEN)
      rect(c, 7, 7, 2, 2, GREEN)
    },
  },
  attack: {
    name: 'Angreifen',
    hot: [8, 8],
    draw: (c) => {
      circle(c, 8, 8, 5, RED)
      line(c, [8, 0.5, 8, 4.5], RED)
      line(c, [8, 11.5, 8, 15.5], RED)
      line(c, [0.5, 8, 4.5, 8], RED)
      line(c, [11.5, 8, 15.5, 8], RED)
    },
  },
  enter: { name: 'Einsteigen / besetzen', hot: [8, 8], draw: (c) => ICONS.garrison.draw(c) },
  capture: { name: 'Erobern', hot: [4, 14], draw: (c) => ICONS.capture.draw(c) },
  forbidden: {
    name: 'Nicht möglich',
    hot: [8, 8],
    draw: (c) => {
      circle(c, 8, 8, 5.5, RED, false, 2.2)
      line(c, [4, 4, 12, 12], RED, 2.2)
    },
  },
  place: {
    name: 'Bauen / platzieren',
    hot: [8, 8],
    draw: (c) => {
      line(c, [8, 2, 15, 8, 8, 14, 1, 8, 8, 2], GREEN, 1.4)
      rect(c, 7, 7, 2, 2, GREEN)
    },
  },
}

// ─────────────────────────────────────────────────────────── buttons and panels (nine-slice)

/** 24 × 24 with a 6 px border that stays as it is when stretched */
export function button(state: 'normal' | 'hover' | 'pressed' | 'disabled'): HTMLCanvasElement {
  const cv = canvas(24, 24)
  const c = cv.getContext('2d')!
  const base = state === 'hover' ? OLIVE_L : state === 'disabled' ? '#3e4236' : OLIVE
  const hi = state === 'disabled' ? '#55594c' : state === 'pressed' ? OLIVE_D : '#8a9668'
  const lo = state === 'disabled' ? '#2a2d24' : state === 'pressed' ? '#8a9668' : OLIVE_D
  rect(c, 0, 0, 24, 24, INK)
  rect(c, 1, 1, 22, 22, base)
  rect(c, 1, 1, 22, 2, hi)
  rect(c, 1, 1, 2, 22, hi)
  rect(c, 1, 21, 22, 2, lo)
  rect(c, 21, 1, 2, 22, lo)
  // rivets in the corners
  const rv = state === 'disabled' ? '#6a6d60' : BRASS
  for (const [x, y] of [[4, 4], [19, 4], [4, 19], [19, 19]]) rect(c, x, y, 1, 1, rv)
  if (state === 'pressed') rect(c, 3, 3, 18, 18, shadeHex(base, 0.92))
  return cv
}

function shadeHex(h: string, k: number) {
  const n = parseInt(h.slice(1), 16)
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)))
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`
}

/** a dark panel with a brass-riveted rim; 32 × 32, border 8 */
export function panel(): HTMLCanvasElement {
  const cv = canvas(32, 32)
  const c = cv.getContext('2d')!
  rect(c, 0, 0, 32, 32, INK)
  rect(c, 1, 1, 30, 30, '#1a1f14')
  rect(c, 2, 2, 28, 1, '#2c3322')
  rect(c, 2, 2, 1, 28, '#2c3322')
  rect(c, 3, 29, 26, 1, '#0c0f09')
  rect(c, 29, 3, 1, 26, '#0c0f09')
  for (const [x, y] of [[4, 4], [27, 4], [4, 27], [27, 27]]) {
    rect(c, x - 1, y, 3, 1, '#a88a30')
    rect(c, x, y - 1, 1, 3, '#a88a30')
    rect(c, x, y, 1, 1, BRASS)
  }
  // hazard stripes along the top edge, in the middle (so they tile when stretched)
  for (let x = 8; x < 24; x++) if ((x >> 1) % 2 === 0) rect(c, x, 0, 1, 1, '#a88a30')
  return cv
}

// ─────────────────────────────────────────────────────────── flags and ranks

export function flag(kind: 'nato' | 'ru'): HTMLCanvasElement {
  const cv = canvas(24, 16)
  const c = cv.getContext('2d')!
  rect(c, 0, 0, 24, 16, INK)
  if (kind === 'ru') {
    rect(c, 1, 1, 22, 5, '#f2f2ec')
    rect(c, 1, 6, 22, 4, '#2a5aa8')
    rect(c, 1, 10, 22, 5, '#c8322a')
  } else {
    // a dark blue field with a white compass star
    rect(c, 1, 1, 22, 14, '#1f3c78')
    const img = pixel(24, 16, (cc) => {
      poly(cc, [12, 2, 13.2, 6.8, 18.5, 8, 13.2, 9.2, 12, 14, 10.8, 9.2, 5.5, 8, 10.8, 6.8], '#f2f2ec')
      for (const [x, y] of [[9, 5], [15, 5], [9, 11], [15, 11]]) rect(cc, x, y, 1, 1, '#f2f2ec')
    }, false)
    c.drawImage(img, 0, 0)
  }
  return cv
}

/** Rekrut has none; 1–2 chevrons, then the veteran's star (as the game draws them) */
export function rank(r: 1 | 2 | 3): HTMLCanvasElement {
  const cv = canvas(9, 9)
  const c = cv.getContext('2d')!
  const px = (a: number, b: number, w: number, h: number, col: string) => rect(c, a + 2, b + 2, w, h, col)
  rect(c, 1, 1, 7, r >= 3 ? 7 : r * 3 + 1, INK)
  if (r >= 3) {
    px(2, 0, 1, 5, BRASS)
    px(0, 2, 5, 1, BRASS)
    px(1, 1, 3, 3, BRASS)
  } else
    for (let k = 0; k < r; k++) {
      const yy = k * 3
      px(0, yy, 1, 1, BRASS)
      px(1, yy + 1, 3, 1, BRASS)
      px(4, yy, 1, 1, BRASS)
    }
  return cv
}

export function icon(key: string): HTMLCanvasElement {
  return pixel(16, 16, ICONS[key].draw)
}
export function cursor(key: string): HTMLCanvasElement {
  return pixel(16, 16, CURSORS[key].draw)
}
