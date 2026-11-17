class_name AI
extends RefCounted
## The computer opponent. It builds its base to a plan, keeps its trucks running, trains a mixed
## army without pause, defends what is attacked, and sends ever larger waves at the player.
##
## Port of src/game/ai.ts. It draws from the game's seeded generator (`g.rand`) in the same order.

const LAND_PLAN: Array[String] = ["power", "ref", "barracks", "power", "factory", "bunker", "ref", "radar", "power", "rocket", "helipad", "power", "airfield", "bunker", "rocket", "factory", "power", "rocket", "bunker"]
const SEA_PLAN: Array[String] = ["power", "ref", "barracks", "power", "factory", "bunker", "ref", "radar", "power", "shipyard", "rocket", "helipad", "power", "airfield", "bunker", "power", "rocket", "factory", "rocket", "bunker"]
const PRIO := {"factory": 14, "barracks": 10, "hq": 12, "airfield": 8, "helipad": 8, "shipyard": 6, "ref": 9, "power": 7, "radar": 5}


## the wave on its way: it gathers short of the target first, then goes in together
class Wave:
	var ids: Array[int] = []
	var stage := Vector2()
	var target: Ent = null
	var t0 := 0.0
	## gather | go
	var phase := "gather"


var p := 1
var g: Game
var _think_t := 2.0
var _plan_idx := 0
var _wave_size: int
var _next_attack: float
# ids as keys, in the order they were added (a JS Set)
var _attackers := {}
var _extra_t := 0
var _r: Rng.Mulberry
var _plan: Array[String]
var _no_shipyard := false
var _fleet := {}
var _next_fleet: float
var _strike_t := 0.0
var _hold_t := 20.0
var _wave: Wave = null
var _waves := 0
var _eng_t := 200.0
# the water next to each enemy building (building id -> tile; buildings never move)
var _shore := {}


func _init(g_: Game) -> void:
	g = g_
	var d: int = g.opts.difficulty
	_wave_size = [5, 7, 8][d]
	_next_attack = [420.0, 300.0, 210.0][d]
	_r = g.rand
	_plan = LAND_PLAN if g.map.type == "land" else SEA_PLAN
	_next_fleet = _next_attack + 60


func update(dt: float) -> void:
	_think_t -= dt
	if _think_t > 0:
		return
	_think_t = [1.4, 0.9, 0.6][g.opts.difficulty]
	var pl := g.players[p]
	if not pl.alive:
		return
	_base()
	_train()
	_army()
	_hold()
	_engineers()


func _mine(key: String = "") -> Array[Ent]:
	var out: Array[Ent] = []
	for e in g.ents:
		if not e.dead and e.owner == p and (key == "" or e.key == key):
			out.append(e)
	return out


func _count(key: String) -> int:
	var n := 0
	for e in g.ents:
		if not e.dead and e.owner == p and e.key == key:
			n += 1
	return n


## our HQ, or else any building of ours
func _hq() -> Ent:
	var first_b: Ent = null
	for e in g.ents:
		if e.dead or e.owner != p:
			continue
		if e.key == "hq":
			return e
		if first_b == null and e.is_b:
			first_b = e
	return first_b


static func _hyp(a: float, b: float) -> float:
	return Rng.hypot(a, b)


## sorts by a distance, keeping the order of equals (JS's sort is stable)
static func _sorted_by(list: Array[Ent], keys: PackedFloat64Array) -> Array[Ent]:
	var out: Array[Ent] = []
	for i in Game.sort_order(keys):
		out.append(list[i])
	return out


## soldiers dig into the houses round the base
func _hold() -> void:
	_hold_t -= _think_t
	if _hold_t > 0:
		return
	_hold_t = 8
	var hq := _hq()
	if hq == null:
		return
	var want: int = [3, 6, 9][g.opts.difficulty]
	var mine := _mine()
	var inside := 0
	for u in mine:
		if u.inside != null or u.order == "enter":
			inside += 1
	if inside >= want:
		return
	var idle: Array[Ent] = []
	for u in mine:
		if not u.is_b and u.infantry and not u.u.get("engineer", false) and u.inside == null and not _attackers.has(u.id) and u.target == null and (u.order == "idle" or (u.order == "amove" and u.dest == null and u.path.is_empty())):
			idle.append(u)
	if idle.size() < 3:
		return
	var free: Array[Game.Garrison] = []
	var fk := PackedFloat64Array()
	for h in g.garrisons:
		if h.b == null and g.can_enter(p, h) and _hyp(h.x - hq.x, h.y - hq.y) < 28:
			free.append(h)
			fk.append(_hyp(h.x - hq.x, h.y - hq.y))
	if free.is_empty():
		return
	var h := free[Game.sort_order(fk)[0]]
	var n := mini(mini(h.cap - h.occ.size(), want - inside), idle.size() - 1)
	if n <= 0:
		return
	var ik := PackedFloat64Array()
	for u in idle:
		ik.append(_hyp(u.x - h.x, u.y - h.y))
	idle = _sorted_by(idle, ik)
	g.command_garrison(idle.slice(0, n), h)


## now and then a sapper tries to take over an enemy building
func _engineers() -> void:
	var pl := g.players[p]
	if g.opts.difficulty == 0:
		return
	_eng_t -= _think_t
	if _eng_t <= 0 and g.has_building(p, "barracks") and pl.credits > 1200 and _count("engineer") == 0:
		_eng_t = 140
		g.queue_item(p, "inf", "engineer")
	for u in _mine("engineer"):
		if u.order != "idle":
			continue
		var best: Ent = null
		var bd := 1e9
		for b in g.ents:
			if not b.is_b or b.dead or b.owner == p or b.key == "hq":
				continue
			var d := _hyp(b.x - u.x, b.y - u.y) + (12.0 if b.b.get("defense", false) else 0.0)
			if d < bd:
				bd = d
				best = b
		if best != null:
			g.command_capture([u], best)


func _base() -> void:
	var pl := g.players[p]
	var q: Array = pl.queues["build"]
	if q.size() > 0 and q[0].ready:
		var key: String = q[0].key
		var spot: Variant = _find_spot(key)
		if spot != null:
			g.place_ready(p, spot.x, spot.y)
		else:
			if key == "shipyard":
				_no_shipyard = true
			g.cancel_item(p, "build", key)
		return
	if q.size() > 0 or _count("hq") == 0:
		return
	if _count("ref") > 0 and _count("harv") == 0 and g.has_building(p, "factory"):
		return
	# keep the lights on first, counting what is still going up
	var prod := 0
	var use := 0
	for e in g.ents:
		if e.dead or e.owner != p or not e.is_b:
			continue
		var pw := int(e.b.power)
		if pw > 0:
			prod += pw
		else:
			use -= pw
	var nxt: int = int(g.bdefs[_plan[_plan_idx]].power) if _plan_idx < _plan.size() else -20
	if use - mini(0, nxt) + 10 > prod:
		g.queue_item(p, "build", "power")
		return
	if _plan_idx < _plan.size():
		var key := _plan[_plan_idx]
		if key == "shipyard" and _no_shipyard:
			_plan_idx += 1
			return
		if g.missing(p, g.bdefs[key].req).size() > 0:
			return
		if g.queue_item(p, "build", key):
			_plan_idx += 1
		return
	# after the plan: more defences now and then while money allows
	_extra_t += 1
	if pl.credits > 2500 and _extra_t % 8 == 0:
		var defs := 0
		for e in g.ents:
			if not e.dead and e.owner == p and e.is_b and e.b.get("defense", false):
				defs += 1
		if defs < 6:
			g.queue_item(p, "build", "rocket" if _r.next() < 0.5 else "bunker")


func _room(pl: Game.Player, q: String, wealthy: bool, busy: int) -> bool:
	return pl.queues[q].size() > 0 or wealthy or busy < 2


func _train() -> void:
	var pl := g.players[p]
	var refs := _count("ref")
	var harv := _count("harv")
	var harv_queued := 0
	for it: Game.QItem in pl.queues["veh"]:
		if it.key == "harv":
			harv_queued += 1
	# no trucks left: everything else waits, the money goes into a new one
	if refs and harv == 0 and g.has_building(p, "factory"):
		for q: String in ["inf", "veh", "air"]:
			for it: Game.QItem in pl.queues[q].duplicate():
				if it.key != "harv":
					g.cancel_item(p, q, it.key)
		if not harv_queued:
			g.queue_item(p, "veh", "harv")
		return
	if refs and harv + harv_queued < mini(refs * 2, 5) and g.has_building(p, "factory") and pl.queues["veh"].size() < 3:
		g.queue_item(p, "veh", "harv")
	var wealthy := pl.credits > 600
	# short of money: no more than two things at once, so something actually gets finished
	var busy := 0
	for q: String in ["inf", "veh", "air", "sea"]:
		if pl.queues[q].size() > 0:
			busy += 1
	if g.has_building(p, "barracks") and pl.queues["inf"].size() < (2 if wealthy else 1) and _room(pl, "inf", wealthy, busy) and (busy == 0 or _r.next() < 0.5):
		g.queue_item(p, "inf", "rifle" if _r.next() < 0.55 else "at")
	if g.has_building(p, "factory") and pl.queues["veh"].size() < (2 if wealthy else 1) and _room(pl, "veh", wealthy, busy):
		var radar := g.has_building(p, "radar")
		var enemy_air := false
		for e in g.ents:
			if e.owner != p and e.is_air and not e.dead:
				enemy_air = true
				break
		var roll := _r.next()
		var key := "mbt" if roll < 0.4 else ("ifv" if roll < 0.66 else ("art" if roll < 0.76 else ("mlrs" if roll < 0.86 else "aa")))
		if not radar and (key == "art" or key == "mlrs" or key == "aa"):
			key = "mbt"
		if enemy_air and radar and _count("aa") < 3:
			key = "aa"
		g.queue_item(p, "veh", key)
	if pl.queues["air"].size() < 1 and _room(pl, "air", wealthy, busy):
		var slots := 0
		for b in _mine("airfield"):
			if b.built >= 1:
				slots += 3
		var jets := 0
		for j in _mine("jet"):
			if j.home:
				var hb: Ent = g.by_id.get(j.home)
				if hb != null and hb.is_b:
					jets += 1
		if slots > jets and (_r.next() < 0.5 or not g.has_building(p, "helipad")):
			g.queue_item(p, "air", "jet")
		elif g.has_building(p, "helipad") and _count("heli") < 4:
			g.queue_item(p, "air", "heli")
	# the navy
	if g.has_building(p, "shipyard") and pl.queues["sea"].size() < 1 and _room(pl, "sea", wealthy, busy):
		var roll := _r.next()
		var key := "boat" if roll < 0.3 else ("corvette" if roll < 0.65 else "destroyer")
		if key == "destroyer" and not g.has_building(p, "radar"):
			key = "corvette"
		if g.has_building(p, "airfield") and _count("carrier") == 0 and roll > 0.85:
			key = "carrier"
		g.queue_item(p, "sea", key)


func _hurt_building(within: float) -> Ent:
	for e in g.ents:
		if not e.dead and e.owner == p and e.is_b and g.time - e.last_hit < within and e.last_attacker != null and not e.last_attacker.dead:
			return e
	return null


func _army() -> void:
	_navy()
	_jets()
	var units: Array[Ent] = []
	for e in _mine():
		if not e.is_b and e.has_wp and not e.is_naval and not e.is_jet and e.inside == null and e.order != "enter":
			units.append(e)
	# defend: whatever hit us recently gets a visit
	var hurt := _hurt_building(6)
	if hurt != null:
		var foe := hurt.last_attacker
		for u in units:
			if not _attackers.has(u.id) and _hyp(u.x - hurt.x, u.y - hurt.y) < 22:
				if u.order == "idle" or (u.order == "amove" and u.target == null):
					g.command_move([u], foe.x, foe.y, true)
	# attack waves: they gather short of the enemy base, then go in together
	for id: int in _attackers.keys():
		if not g.by_id.has(id):
			_attackers.erase(id)
	var idle: Array[Ent] = []
	for u in units:
		if not _attackers.has(u.id) and (u.order == "idle" or (u.order == "amove" and u.dest == null and u.path.is_empty())):
			idle.append(u)
	# late in the game: everything but a few guards goes
	var all_in := g.time > 18 * 60
	var keep := 3 if all_in else 0
	var ready := idle.size() - keep >= _wave_size or (g.time > _next_attack + 90 and idle.size() - keep >= 5)
	if _wave == null and g.time > _next_attack and ready:
		var target := _siege_target()
		var base := _hq()
		if target != null and base != null:
			var ik := PackedFloat64Array()
			for u in idle:
				ik.append(_hyp(u.x - target.x, u.y - target.y))
			idle = _sorted_by(idle, ik)
			var go := idle.slice(0, idle.size() - keep)
			var d := _hyp(base.x - target.x, base.y - target.y)
			if d == 0:
				d = 1
			var k := minf(12, d * 0.45)
			var sp := g.pf.nearest_walkable(target.x + ((base.x - target.x) / d) * k, target.y + ((base.y - target.y) / d) * k)
			var stage := Vector2(sp.x + 0.5, sp.y + 0.5) if sp.x >= 0 else Vector2(target.x, target.y)
			g.command_move(go, stage.x, stage.y, true)
			for u: Ent in go:
				_attackers[u.id] = true
			_wave = Wave.new()
			for u: Ent in go:
				_wave.ids.append(u.id)
			_wave.stage = stage
			_wave.target = target
			_wave.t0 = g.time
			_wave.phase = "gather"
			_waves += 1
			_wave_size = mini(14, _wave_size + 2)
			_next_attack = g.time + maxf(45, [150, 110, 80][g.opts.difficulty] - _waves * 8)
			g.msg("Feindliche Truppen rücken vor!", "warn")
	if _wave != null:
		var w := _wave
		var live: Array[Ent] = []
		for id in w.ids:
			var u: Ent = g.by_id.get(id)
			if u != null and not u.dead:
				live.append(u)
		if live.is_empty():
			_wave = null
		elif w.phase == "gather":
			var near := 0
			for u in live:
				if _hyp(u.x - w.stage.x, u.y - w.stage.y) < 5:
					near += 1
			if near >= live.size() * 0.7 or g.time - w.t0 > 45:
				var t := _siege_target() if w.target.dead else w.target
				if t != null:
					g.command_move(live, t.x, t.y, true)
				w.phase = "go"
				if t == null:
					_wave = null
		else:
			_wave = null
	# attackers that have arrived look for the next target
	for id: int in _attackers.keys():
		var u: Ent = g.by_id.get(id)
		if u == null:
			continue
		if _wave != null and _wave.phase == "gather" and _wave.ids.has(id):
			continue
		if u.order == "idle" or (u.order == "amove" and u.target == null and u.path.is_empty() and u.dest == null):
			var t := _target_building(u)
			if t != null:
				g.command_move([u], t.x, t.y, true)
	# idle units gather in front of the base
	var hq := _hq()
	if hq != null:
		var enemy: Ent = null
		for e in g.ents:
			if e.owner != p and e.key == "hq":
				enemy = e
				break
		if enemy == null:
			for e in g.ents:
				if e.owner != p and e.is_b:
					enemy = e
					break
		var ex := enemy.x if enemy != null else g.map.N / 2.0
		var ey := enemy.y if enemy != null else g.map.N / 2.0
		var d := _hyp(ex - hq.x, ey - hq.y)
		if d == 0:
			d = 1
		var rx := hq.x + ((ex - hq.x) / d) * 9
		var ry := hq.y + ((ey - hq.y) / d) * 9
		var loose: Array[Ent] = []
		for u in idle:
			if _hyp(u.x - rx, u.y - ry) > 5 and u.target == null and _hyp(u.x - hq.x, u.y - hq.y) < 14:
				loose.append(u)
		if loose.size() > 0:
			g.command_move(loose, rx, ry, true)


## ships sail in groups for the enemy buildings nearest the water
func _navy() -> void:
	for id: int in _fleet.keys():
		if not g.by_id.has(id):
			_fleet.erase(id)
	var idle: Array[Ent] = []
	var carrier_idle: Array[Ent] = []
	for e in _mine():
		if e.is_naval and e.has_wp and not _fleet.has(e.id) and (e.order == "idle" or (e.order == "amove" and e.dest == null and e.path.is_empty())):
			idle.append(e)
	for c in _mine("carrier"):
		if c.order == "idle" and c.dest == null:
			carrier_idle.append(c)
	if g.time > _next_fleet and idle.size() >= 3:
		var t: Variant = _shore_target(null)
		if t != null:
			g.command_move(idle + carrier_idle, t.x, t.y, true)
			for u in idle:
				_fleet[u.id] = true
			_next_fleet = g.time + 90
	for id: int in _fleet.keys():
		var u: Ent = g.by_id.get(id)
		if u == null:
			continue
		if u.order == "idle" or (u.order == "amove" and u.target == null and u.path.is_empty() and u.dest == null):
			var t: Variant = _shore_target(u)
			if t != null:
				g.command_move([u], t.x, t.y, true)


## the water next to the enemy building closest to it (Vector2 or null)
func _shore_target(from: Ent) -> Variant:
	var best: Variant = null
	var bd := 1e9
	for e in g.ents:
		if e.dead or e.owner == p or not e.is_b:
			continue
		var w: Vector2i
		if _shore.has(e.id):
			w = _shore[e.id]
		else:
			w = g.npf.nearest_walkable(e.x, e.y, 9)
			_shore[e.id] = w
		if w.x < 0:
			continue
		var d := _hyp(w.x - e.x, w.y - e.y) * 4 + (_hyp(e.x - from.x, e.y - from.y) * 0.3 if from != null else 0.0)
		if d < bd:
			bd = d
			best = Vector2(w.x + 0.5, w.y + 0.5)
	return best


## jets on the ground with weapons aboard fly at whatever matters most
func _jets() -> void:
	if g.time < _strike_t:
		return
	var ready: Array[Ent] = []
	for j in _mine("jet"):
		if j.js == "park" and j.ammo >= 1:
			ready.append(j)
	if ready.is_empty():
		return
	_strike_t = g.time + 12
	# first whatever is hitting the base, else a building
	var hurt := _hurt_building(8)
	var t: Ent = hurt.last_attacker if hurt != null else null
	if t == null:
		var blds: Array[Ent] = []
		for e in g.ents:
			if not e.dead and e.owner != p and e.is_b:
				blds.append(e)
		_v8_sort(blds, func(a: Ent, b: Ent) -> int:
			var c := (1 if b.has_wp else 0) - (1 if a.has_wp else 0)
			return c if c != 0 else (-1 if a.key == "power" else 0))
		var i := floori(_r.next() * mini(4, blds.size()))
		t = blds[i] if i < blds.size() else null
	if t != null:
		g.command_strike(ready, t, t.x, t.y)


## Array.prototype.sort as V8 does it for short arrays (a run, then binary insertion), so even an
## inconsistent comparator gives the prototype's order
static func _v8_sort(a: Array[Ent], cmp: Callable) -> void:
	var n := a.size()
	if n < 2:
		return
	# the first run: ascending, or strictly descending (then reversed)
	var run := 2
	var desc: bool = cmp.call(a[1], a[0]) < 0
	var prev := a[1]
	for idx in range(2, n):
		var cur := a[idx]
		var order: int = cmp.call(cur, prev)
		if desc:
			if order >= 0:
				break
		elif order < 0:
			break
		prev = cur
		run += 1
	if desc:
		var lo := 0
		var hi := run - 1
		while lo < hi:
			var tmp := a[lo]
			a[lo] = a[hi]
			a[hi] = tmp
			lo += 1
			hi -= 1
	for start in range(run, n):
		var pivot := a[start]
		var left := 0
		var right := start
		while left < right:
			var mid := left + ((right - left) >> 1)
			if cmp.call(pivot, a[mid]) < 0:
				right = mid
			else:
				left = mid + 1
		var q := start
		while q > left:
			a[q] = a[q - 1]
			q -= 1
		a[left] = pivot


## where a wave goes: the enemy's production and command first, the nearest of them to our base
func _siege_target() -> Ent:
	var hq := _hq()
	if hq == null:
		return null
	var best: Ent = null
	var bs := 1e9
	for e in g.ents:
		if e.dead or e.owner == p or not e.is_b:
			continue
		var sc := _hyp(e.x - hq.x, e.y - hq.y) - float(PRIO.get(e.key, 0))
		if sc < bs:
			bs = sc
			best = e
	return best if best != null else _target_building(null)


func _target_building(from: Ent) -> Ent:
	var hq := from
	if hq == null:
		for e in g.ents:
			if not e.dead and e.owner == p and e.key == "hq":
				hq = e
				break
	if hq == null:
		for e in g.ents:
			if not e.dead and e.owner == p:
				hq = e
				break
	if hq == null:
		return null
	var best: Ent = null
	var bd := 1e9
	for e in g.ents:
		if e.dead or e.owner == p:
			continue
		if not e.is_b and from != null:
			continue
		var d := _hyp(e.x - hq.x, e.y - hq.y) - (3.0 if from != null and e.is_b and (e.b.get("produces") or e.key == "hq") else 0.0)
		if d < bd:
			bd = d
			best = e
	if best == null and from != null:
		for e in g.ents:
			if e.dead or e.owner == p:
				continue
			var d := _hyp(e.x - hq.x, e.y - hq.y)
			if d < bd:
				bd = d
				best = e
	return best


## a free spot near the base, with a gap round it so the roads stay open (Vector2i or null)
func _find_spot(key: String) -> Variant:
	var m := g.map
	var def: Dictionary = g.bdefs[key]
	var dw := int(def.w)
	var dh := int(def.h)
	var hq := _hq()
	if hq == null:
		return null
	var shore: bool = def.get("shore", false)
	var defense: bool = def.get("defense", false)
	var far := 22 if shore else 16
	var enemy: Ent = null
	for e in g.ents:
		if e.owner != p and e.key == "hq":
			enemy = e
			break
	var ex := enemy.x if enemy != null else m.N / 2.0
	var ey := enemy.y if enemy != null else m.N / 2.0
	var best: Variant = null
	var bs := 1e9
	@warning_ignore("integer_division")
	var hw := dw / 2
	@warning_ignore("integer_division")
	var hh := dh / 2
	for r in range(2, far + 1):
		for dy in range(-r, r + 1):
			# the ring only (the same order as the square with the inside skipped)
			for dx in range(-r, r + 1, 1 if dy == -r or dy == r else 2 * r):
				var tx := floori(hq.x) + dx - hw
				var ty := floori(hq.y) + dy - hh
				# (both checks are pure, the cheap one first)
				if not _gap_free(tx, ty, dw, dh):
					continue
				if not g.can_place(p, key, tx, ty):
					continue
				var cx := tx + dw / 2.0
				var cy := ty + dh / 2.0
				var s := r + _r.next() * 2
				if key == "ref":
					s = _ore_dist(cx, cy) * 2 + r * 0.3
				if defense:
					s = _hyp(cx - (hq.x + (ex - hq.x) * 0.12), cy - (hq.y + (ey - hq.y) * 0.12)) + _r.next() * 3
				if s < bs:
					bs = s
					best = Vector2i(tx, ty)
		if best != null and r > 6 and not shore:
			break
	return best


func _gap_free(tx: int, ty: int, w: int, h: int) -> bool:
	var m := g.map
	var N := m.N
	if tx - 1 < 0 or ty - 1 < 0 or tx + w >= N or ty + h >= N:
		return false
	var bld := m.bld
	for y in range(ty - 1, ty + h + 1):
		for x in range(tx - 1, tx + w + 1):
			if bld[y * N + x]:
				return false
	return true


## distance to the nearest ore within 14 tiles (99 if none); rings outward, the same minimum
func _ore_dist(x: float, y: float) -> float:
	var m := g.map
	var ore := m.ore
	var N := m.N
	var bd := 99.0
	var fx := floori(x)
	var fy := floori(y)
	for r in 15:
		if bd <= r:
			break
		for dy in range(-r, r + 1):
			# the ring only (the same order as the square with the inside skipped)
			for dx in range(-r, r + 1, 1 if dy == -r or dy == r else 2 * r):
				var tx := fx + dx
				var ty := fy + dy
				if tx < 0 or ty < 0 or tx >= N or ty >= N:
					continue
				if ore[ty * N + tx] > 0:
					bd = minf(bd, _hyp(dx, dy))
	return bd
