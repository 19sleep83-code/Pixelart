// Dev-only page: draws every model so the art can be checked (npm run dev → /preview.html)
import { Rot, renderSprite } from './core/voxel'
import { unitModel, buildingModel, treeModel, houseModel, oreModel } from './game/models'
import type { Faction } from './game/colors'

const cv = document.getElementById('c') as HTMLCanvasElement
const S = 3
cv.width = 1400; cv.height = 900
cv.style.width = cv.width * S / 2 + 'px'
const ctx = cv.getContext('2d')!
ctx.imageSmoothingEnabled = false
ctx.fillStyle = '#5f8a3a'; ctx.fillRect(0, 0, cv.width, cv.height)
let x = 30, y = 40
const put = (sp: { cv: HTMLCanvasElement; ax: number; ay: number }, sh?: { cv: HTMLCanvasElement; ax: number; ay: number }) => {
  if (sh) ctx.drawImage(sh.cv, x - sh.ax, y - sh.ay)
  ctx.drawImage(sp.cv, x - sp.ax, y - sp.ay)
}
for (const f of ['nato', 'ru'] as Faction[]) {
  x = 30
  for (const k of ['mbt', 'ifv', 'art', 'aa', 'harv', 'rifle', 'at', 'heli']) {
    const um = unitModel(k, f)
    for (const yaw of [0.6, 2.4]) {
      const r = new Rot(um.hull, 1)
      const sp = renderSprite(um.hull, yaw)
      put(sp, undefined)
      if (um.turret && um.mount) {
        const t = renderSprite(um.turret, yaw)
        const [a, b, c] = um.mount
        const rx = -a * Math.sin(yaw) + b * Math.cos(yaw), ry = a * Math.cos(yaw) + b * Math.sin(yaw)
        ctx.drawImage(t.cv, x + (rx - ry) - t.ax, y + (rx + ry) / 2 - c * 1.25 - t.ay)
      }
      void r
      x += 45
    }
  }
  y += 50
}
y += 40
x = 50
for (const f of ['nato', 'ru'] as Faction[]) {
  x = 50
  for (const k of ['hq', 'power', 'ref', 'barracks', 'factory', 'radar', 'helipad', 'bunker', 'rocket']) {
    const bm = buildingModel(k, f)
    put(renderSprite(bm.body, 0))
    if (bm.turret) { const t = renderSprite(bm.turret, 1); ctx.drawImage(t.cv, x - t.ax, y - (bm.mount![2]) * 1.25 - t.ay) }
    x += k === 'hq' || k === 'ref' || k === 'factory' ? 110 : 75
  }
  y += 110
}
x = 30; y += 20
for (let i = 0; i < 4; i++) { put(renderSprite(treeModel('oak', i), 0)); x += 35 }
for (let i = 0; i < 3; i++) { put(renderSprite(treeModel('pine', i), 0)); x += 35 }
for (let i = 0; i < 2; i++) { put(renderSprite(treeModel('birch', i), 0)); x += 35 }
put(renderSprite(treeModel('bush', 1), 0)); x += 35
for (const k of ['house', 'timber', 'church', 'barn'] as const) { put(renderSprite(houseModel(k, 3), 0)); x += 40 }
for (let s = 0; s < 3; s++) { put(renderSprite(oreModel(s, 2), 0)); x += 35 }
document.title = 'ready'
