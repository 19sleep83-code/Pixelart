// Start-up: the main menu, loading, and the frame loop that runs a battle.
import './style.css'
import { buildAssets, type Assets } from './game/assets'
import { Game, type GameOpts } from './game/game'
import { Terrain } from './game/terrain'
import { Renderer } from './game/render'
import { Input } from './game/input'
import { AI } from './game/ai'
import { Hud } from './ui/hud'
import type { Faction } from './game/colors'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const STEP = 1 / 30

const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem('pixelfront:' + k)
    } catch {
      return null
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem('pixelfront:' + k, v)
    } catch {
      /* private mode: settings are simply not kept */
    }
  },
}

let assets: Promise<Assets> | null = null
const opts: GameOpts = {
  faction: (store.get('faction') as Faction) || 'nato',
  difficulty: (Number(store.get('diff') ?? 1) as 0 | 1 | 2),
  seed: Math.floor(Math.random() * 99999) + 1,
}

function seg(id: string, value: string, on: (v: string) => void) {
  const el = $(id)
  el.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.classList.toggle('on', b.dataset.v === value)
    b.onclick = () => {
      el.querySelectorAll('button').forEach((x) => x.classList.remove('on'))
      b.classList.add('on')
      on(b.dataset.v!)
    }
  })
}

function show(panel: 'menu' | 'loading' | 'pause' | 'end' | null, overGame = false) {
  for (const p of ['menu', 'loading', 'pause', 'end']) $(p).classList.toggle('hidden', p !== panel)
  $('screen').classList.toggle('off', panel === null)
  $('screen').classList.toggle('over', overGame)
}

function menu() {
  stopGame()
  $('app').classList.add('hidden')
  show('menu')
  seg('opt-faction', opts.faction, (v) => {
    opts.faction = v as Faction
    store.set('faction', v)
  })
  seg('opt-diff', String(opts.difficulty), (v) => {
    opts.difficulty = +v as 0 | 1 | 2
    store.set('diff', v)
  })
  const seed = $<HTMLInputElement>('opt-seed')
  seed.value = String(opts.seed)
  seed.onchange = () => (opts.seed = Math.max(1, Math.floor(+seed.value) || 1))
  $('opt-rand').onclick = () => {
    opts.seed = Math.floor(Math.random() * 99999) + 1
    seed.value = String(opts.seed)
  }
  $('start').onclick = () => start()
}

// ─────────────────────────────────────────────────────── a running battle

interface Session {
  game: Game
  r: Renderer
  input: Input
  hud: Hud
  ai: AI
  abort: AbortController
  raf: number
  paused: boolean
  ended: boolean
}
let S: Session | null = null

function stopGame() {
  if (!S) return
  cancelAnimationFrame(S.raf)
  S.abort.abort()
  S = null
}

async function start() {
  stopGame()
  show('loading')
  const fill = $('load-fill'), what = $('load-what')
  const progress = (t: number, w: string) => {
    fill.style.width = `${Math.round(t * 85)}%`
    what.textContent = w
  }
  assets ??= buildAssets(progress)
  const A = await assets
  progress(0.9, 'Landschaft wird gemalt …')
  await new Promise((r) => setTimeout(r, 30))
  const game = new Game({ ...opts })
  const terrain = new Terrain(game.map)
  terrain.paint()
  terrain.bakeStatics(A)
  progress(1, 'Bereit')

  $('app').classList.remove('hidden')
  const view = $<HTMLCanvasElement>('view')
  const wrap = $('view-wrap')
  const r = new Renderer(game, A, terrain, view)
  const abort = new AbortController()
  let zoom = Number(store.get('zoom') ?? 0)
  const scale = () => {
    const base = wrap.clientWidth > 1500 ? 3 : 2
    return Math.max(1, Math.min(5, base + zoom))
  }
  const resize = () => {
    const s = scale()
    const w = Math.ceil(wrap.clientWidth / s), h = Math.ceil(wrap.clientHeight / s)
    const cx = r.cam.x + r.W / 2, cy = r.cam.y + r.H / 2
    r.resize(w, h)
    r.cam.x = cx - w / 2
    r.cam.y = cy - h / 2
    r.clampCam()
    view.style.width = `${w * s}px`
    view.style.height = `${h * s}px`
  }
  const input = new Input(game, r, view, scale, abort.signal)
  const hud = new Hud(game, A, r, input, terrain, abort.signal)
  const ai = new AI(game)
  window.addEventListener('resize', resize, { signal: abort.signal })
  view.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      const before = scale()
      zoom += e.deltaY < 0 ? 1 : -1
      zoom = Math.max(-1, Math.min(2, zoom))
      if (scale() !== before) {
        store.set('zoom', String(zoom))
        resize()
      }
    },
    { signal: abort.signal, passive: false },
  )
  resize()
  const hq = game.ents.find((e) => e.owner === 0 && e.key === 'hq')!
  r.lookAt(hq.x + 2, hq.y - 2)

  const s: Session = { game, r, input, hud, ai, abort, raf: 0, paused: false, ended: false }
  S = s
  ;(window as unknown as { __pf: Session }).__pf = s
  const pause = (on: boolean) => {
    if (s.ended) return
    s.paused = on
    input.paused = on
    show(on ? 'pause' : null, true)
  }
  input.onPause = () => pause(!s.paused)
  $('menu-btn').onclick = () => pause(true)
  $('resume').onclick = () => pause(false)
  $('restart').onclick = () => {
    opts.seed = Math.floor(Math.random() * 99999) + 1
    start()
  }
  $('quit').onclick = () => menu()
  $('again').onclick = () => {
    opts.seed = Math.floor(Math.random() * 99999) + 1
    start()
  }
  $('end-menu').onclick = () => menu()
  show(null)

  game.msg('Baue ein Kraftwerk und ein Rohstoffdepot.', 'info')
  let last = performance.now()
  let acc = 0
  let frames = 0
  const frame = (now: number) => {
    if (S !== s) return
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    if (!s.paused) {
      acc += dt
      let n = 0
      while (acc >= STEP && n < 6) {
        game.update(STEP)
        ai.update(STEP)
        acc -= STEP
        n++
      }
      if (n >= 6) acc = 0
      input.scroll(dt)
    }
    input.frame()
    r.draw(input.overlay)
    hud.update()
    if (frames++ % 4 === 0) hud.drawMini()
    if (game.over && !s.ended) {
      s.ended = true
      setTimeout(() => endScreen(game), 1500)
    }
    s.raf = requestAnimationFrame(frame)
  }
  s.raf = requestAnimationFrame(frame)
}

function endScreen(game: Game) {
  const win = game.over === 1
  $('end-title').textContent = win ? 'Sieg!' : 'Niederlage'
  const [me, foe] = game.players
  const t = Math.floor(game.time)
  $('end-stats').innerHTML =
    `<span class="h"></span><span class="h">${me.faction === 'nato' ? 'NATO' : 'Russland'}</span><span class="h">${foe.faction === 'nato' ? 'NATO' : 'Russland'}</span>` +
    `<span>Zerstört</span><span>${me.stats.killed}</span><span>${foe.stats.killed}</span>` +
    `<span>Verloren</span><span>${me.stats.lost}</span><span>${foe.stats.lost}</span>` +
    `<span>Gebäude gebaut</span><span>${me.stats.built}</span><span>${foe.stats.built}</span>` +
    `<span>Erz gefördert</span><span>${Math.round(me.stats.harvested)}</span><span>${Math.round(foe.stats.harvested)}</span>` +
    `<span>Dauer</span><span>${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}</span><span></span>`
  if (S) {
    S.paused = true
    S.input.paused = true
  }
  show('end', true)
}

menu()
