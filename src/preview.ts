// Dev-only page: draws every model so the art can be checked (npm run dev → /preview.html)
import { renderSprite, renderShadow, type Vox } from './core/voxel'
import { unitModel, buildingModel, titleModel } from './game/models'
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
ctx.fillRect(0, 300, cv.width, 260)
let x = 40, y = 60
const yaw = 2.3
const put = (m: Vox, a = yaw, shadow = true) => {
  if (shadow) {
    const sh = renderShadow(m, a)
    ctx.drawImage(sh.cv, x - sh.ax, y - sh.ay)
  }
  const sp = renderSprite(m, a)
  ctx.drawImage(sp.cv, x - sp.ax, y - sp.ay)
}
const land = ['mbt', 'ifv', 'scout', 'aa', 'art', 'mlrs', 'harv', 'heli', 'jet']
for (const f of ['nato', 'ru'] as Faction[]) {
  x = 40
  for (const k of land) {
    const um = unitModel(k, f)
    put(um.hull)
    if (um.turret && um.mount) {
      const t = renderSprite(um.turret, yaw)
      const [dx, dy] = mountOffset(um.mount, yaw)
      ctx.drawImage(t.cv, x + dx - t.ax, y + dy - t.ay)
    }
    x += k === 'heli' || k === 'jet' ? 75 : 62
  }
  // the soldiers in their four poses
  for (const k of ['rifle', 'at', 'sniper']) {
    const um = unitModel(k, f)
    for (const m of [um.hull, um.alt!, um.alt2!, um.aim!]) {
      put(m, 0.8)
      x += 16
    }
    x += 10
  }
  y += 110
}
y = 380
for (const f of ['nato', 'ru'] as Faction[]) {
  x = 60
  for (const k of ['boat', 'corvette', 'destroyer', 'lander', 'carrier']) {
    const um = unitModel(k, f)
    put(um.hullAnim ? um.hullAnim[1] : um.hull, 2.6, false)
    if (um.turret && um.mount) {
      const t = renderSprite(um.turret, 2.6)
      const [dx, dy] = mountOffset(um.mount, 2.6)
      ctx.drawImage(t.cv, x + dx - t.ax, y + dy - t.ay)
    }
    x += k === 'carrier' ? 200 : k === 'destroyer' ? 140 : 110
  }
  y += 110
}
y = 660
x = 80
for (const k of ['airfield', 'shipyard']) {
  put(buildingModel(k, 'nato').body, 0)
  x += 160
}
x = 700
put(titleModel('PIXELFRONT'), -Math.PI / 4, false)
document.title = 'ready'
