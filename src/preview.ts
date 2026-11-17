// Dev-only page: draws every model so the art can be checked (npm run dev → /preview.html)
import { renderSprite, renderShadow } from './core/voxel'
import { unitModel, buildingModel, treeModel, houseModel, oreModel, titleModel } from './game/models'
import { mountOffset } from './game/assets'
import type { Faction } from './game/colors'

const cv = document.getElementById('c') as HTMLCanvasElement
cv.width = 1400
cv.height = 1000
const ctx = cv.getContext('2d')!
ctx.imageSmoothingEnabled = false
ctx.fillStyle = '#5f8a3a'
ctx.fillRect(0, 0, cv.width, cv.height)
ctx.fillStyle = '#3c6c86'
ctx.fillRect(0, 230, cv.width, 150)
let x = 30, y = 40
const put = (sp: { cv: HTMLCanvasElement; ax: number; ay: number }) => ctx.drawImage(sp.cv, x - sp.ax, y - sp.ay)
const land = ['art', 'mlrs', 'mbt', 'ifv', 'scout', 'aa', 'harv', 'heli', 'jet']
const sea = ['boat', 'corvette', 'destroyer', 'lander', 'carrier']
for (const f of ['nato', 'ru'] as Faction[]) {
  x = 30
  for (const k of land) {
    const um = unitModel(k, f)
    const yaw = 0.6
    put(renderShadow(um.hull, yaw))
    put(renderSprite(um.hull, yaw))
    if (um.turret && um.mount) {
      const t = renderSprite(um.turret, yaw)
      const [dx, dy] = mountOffset(um.mount, yaw)
      ctx.drawImage(t.cv, x + dx - t.ax, y + dy - t.ay)
    }
    x += k === 'jet' || k === 'heli' ? 60 : 45
  }
  y += 70
}
y = 290
for (const f of ['nato', 'ru'] as Faction[]) {
  x = 60
  for (const k of sea) {
    const um = unitModel(k, f)
    const yaw = 2.6
    put(renderSprite(um.hull, yaw))
    if (um.turret && um.mount) {
      const t = renderSprite(um.turret, yaw)
      const [dx, dy] = mountOffset(um.mount, yaw)
      ctx.drawImage(t.cv, x + dx - t.ax, y + dy - t.ay)
    }
    x += k === 'carrier' ? 130 : 90
  }
  y += 70
}
y = 480
for (const f of ['nato', 'ru'] as Faction[]) {
  x = 70
  for (const k of ['airfield', 'shipyard', 'hq', 'factory']) {
    const bm = buildingModel(k, f)
    put(renderSprite(bm.body, 0))
    x += 140
  }
  y += 120
}
x = 30
y += 30
for (let i = 0; i < 3; i++) { put(renderSprite(treeModel('oak', i), 0)); x += 35 }
for (const k of ['house', 'timber', 'church'] as const) { put(renderSprite(houseModel(k, 3), 0)); x += 40 }
for (let s = 0; s < 3; s++) { put(renderSprite(oreModel(s, 2), 0)); x += 35 }
x = 900
put(renderSprite(titleModel('PIXELFRONT'), -Math.PI / 4))
document.title = 'ready'
