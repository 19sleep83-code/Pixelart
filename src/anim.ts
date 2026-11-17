// Extra frames for the next version: soldiers falling, the shadows of turrets, muzzle flashes.

import { Vox, toSprite, type Sprite } from './core/voxel'
import { toABGR, TW, TH } from './core/iso'

/** a copy of a model turned about the x axis through its pivot at the ground: falling backwards (-y) */
export function fallen(m: Vox, a: number): Vox {
  const H = m.H / m.res, L = m.L / m.res, W = m.W / m.res
  const back = Math.ceil(H) + 1
  const out = new Vox(W, L + back, Math.max(4, Math.ceil(H * Math.cos(a) + L * Math.sin(a)) + 2))
  out.px = m.px
  out.py = m.py + back
  const r = out.res
  const c = Math.cos(a), s = Math.sin(a)
  for (let fz = 0; fz < out.H; fz++)
    for (let fy = 0; fy < out.L; fy++)
      for (let fx = 0; fx < out.W; fx++) {
        // back to the standing model
        const y1 = (fy + 0.5) / r - back - m.py, z1 = (fz + 0.5) / r
        const y0 = m.py + y1 * c + z1 * s
        const z0 = -y1 * s + z1 * c
        const v = m.get((fx + 0.5) / r, y0, z0)
        if (!v) continue
        out.dot((fx + 0.5) / r, (fy + 0.5) / r, (fz + 0.5) / r, v & 0xffffff)
      }
  return out
}

/** a copy of a model lifted by dz units (for a turret's shadow from its true height) */
export function lifted(m: Vox, dz: number): Vox {
  const out = new Vox(m.W / m.res, m.L / m.res, m.H / m.res + Math.ceil(dz))
  out.px = m.px
  out.py = m.py
  const r = out.res
  for (let fz = 0; fz < m.H; fz++)
    for (let fy = 0; fy < m.L; fy++)
      for (let fx = 0; fx < m.W; fx++) {
        const v = m.get((fx + 0.5) / r, (fy + 0.5) / r, (fz + 0.5) / r)
        if (v) out.dot((fx + 0.5) / r, (fy + 0.5) / r, (fz + 0.5) / r + dz, v & 0xffffff)
      }
  return out
}

/**
 * Muzzle flashes pointing along a heading: a hot core, a flame forward and sparks to the sides.
 * size 0 a rifle, 1 a cannon, 2 a howitzer; two frames that flicker.
 */
export function muzzleFlash(size: number, yaw: number, frame: number): Sprite {
  const R = [5, 9, 15][size] * (frame ? 0.8 : 1)
  const S = Math.ceil(R * 2.6) * 2 + 4
  const px = new Uint32Array(S * S)
  // the heading on screen
  const dx = (Math.cos(yaw) - Math.sin(yaw)) * (TW / 2), dy = (Math.cos(yaw) + Math.sin(yaw)) * (TH / 2)
  const l = Math.hypot(dx, dy) || 1
  const ux = dx / l, uy = dy / l
  const COLS = [0xfffbe0, 0xffe07a, 0xffb13a, 0xf07a26]
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const ox = x - S / 2 + 0.5, oy = y - S / 2 + 0.5
      const along = ox * ux + oy * uy, across = -ox * uy + oy * ux
      // a teardrop forward, a small round core, two side jets for the bigger guns
      const fwd = along > 0 ? Math.hypot(along / (R * 2.4), across / (R * 0.55)) : Math.hypot(along / (R * 0.6), across / (R * 0.6))
      const side = size > 0 ? Math.hypot((along - R * 0.3) / (R * 0.35), (Math.abs(across) - R * 0.9) / (R * 0.3)) : 9
      const d = Math.min(fwd, side)
      const n = ((x * 7 + y * 13 + frame * 5) % 11) / 11
      if (d + n * 0.25 > 1) continue
      px[y * S + x] = toABGR(COLS[Math.min(3, Math.floor(d * 4))])
    }
  return toSprite(px, S, S, S >> 1, S >> 1)
}
