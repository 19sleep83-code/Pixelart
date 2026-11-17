class_name Game
extends RefCounted
## The state of a battle and everything that changes it: units driving and fighting, shells in
## the air, buildings going up, ore being hauled, money and power, and the fog over the map.
##
## Port of src/game/game.ts. Same algorithms, numbers and order of the seeded random numbers
## (`rand`); `Math.random()` of the prototype is `randf()`. For speed some lookups are cached
## (building list, the computer's sight once per tick, the shore next to a building); see
## PORTING.md "Game-API" for the public surface.

const ARMORS: Array[String] = ["inf", "light", "heavy", "bld", "air", "ship"]
const WCLASSES: Array[String] = ["mg", "cannon", "auto", "rocket", "art", "flak", "sniper", "missile"]
const QUEUES: Array[String] = ["build", "inf", "veh", "air", "sea"]
## how fast each kind of projectile flies, tiles per second
const SPEED := {"bullet": 26.0, "flak": 24.0, "shell": 20.0, "rocket": 9.0, "art": 7.0, "mlrs": 8.0, "missile": 8.0, "snipe": 40.0}
## used when rules.json has no `garrison` table
const GSPEC_DEFAULT := {
	"house": {"cap": 4, "range": 1.5, "sight": 2, "name": "Wohnhaus"},
	"barn": {"cap": 3, "range": 1, "sight": 1.5, "name": "Scheune"},
	"church": {"cap": 6, "range": 2.5, "sight": 4, "name": "Kirche"},
	"bunker": {"cap": 3, "range": 1, "sight": 1, "name": "MG-Bunker"},
}
const FX_KINDS: Array[String] = ["exp", "smoke", "fire", "flash", "spark", "dust", "debris", "wake", "splash", "ring", "clod", "ember"]
const FX_DEBRIS := 6
const FX_CLOD := 10
const FX_EMBER := 11
const FX_SMOKE := 1
const OFF: Array[Vector2] = [Vector2(0.5, 0.5), Vector2(0.25, 0.3), Vector2(0.75, 0.7), Vector2(0.3, 0.75)]
const DIRS4: Array[Vector2i] = [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]
## the path search limit for goals that cannot be reached (see _max_nodes)
const UNREACHABLE_NODES := 600


## what can be held by soldiers: a village house, the church, a barn, or a bunker of our own
class Garrison:
	var id := 0
	## house | church | barn | bunker
	var kind := ""
	var name := ""
	## the middle of it, and its footprint
	var x := 0.0
	var y := 0.0
	var tx := 0
	var ty := 0
	var w := 1
	var h := 1
	var cap := 0
	var occ: Array[Ent] = []
	## who holds it, -1 nobody
	var owner := -1
	## extra reach and sight from the windows (or the tower)
	@warning_ignore("shadowed_global_identifier")
	var range := 0.0
	var sight := 0.0
	## the bunker it belongs to
	var b: Ent = null


class QItem:
	var key := ""
	var paid := 0.0
	var progress := 0.0
	var ready := false

	func _init(key_: String) -> void:
		key = key_


class Stats:
	var built := 0
	var lost := 0
	var killed := 0
	var harvested := 0.0


class Player:
	var id := 0
	var faction := "nato"
	var ai := false
	var credits := 0.0
	var power_prod := 0
	var power_use := 0
	## key -> unit def Dictionary (the playable units of this side)
	var units: Dictionary = {}
	## queue name -> Array of QItem
	var queues: Dictionary = {}
	var alive := true
	var stats := Stats.new()
	## queue name -> id of the producer new units of that queue leave from
	var primary: Dictionary = {}
	var income := 0.0


class Shot:
	## bullet | shell | rocket | art | mlrs | flak | missile | snipe
	var kind := ""
	var owner := 0
	var x0 := 0.0
	var y0 := 0.0
	var z0 := 0.0
	var x1 := 0.0
	var y1 := 0.0
	var z1 := 0.0
	var target: Ent = null
	var t := 0.0
	## flight time
	var T := 0.0
	var arc := 0.0
	var dmg := 0.0
	var cls := ""
	var cls_i := 0
	var splash := 0.0
	var trail_t := 0.0
	## the shooter, for its record
	var src := 0


class Fx:
	## exp | smoke | fire | flash | spark | dust | debris | wake | splash | ring | clod | ember
	var kind := ""
	var ki := 0
	var x := 0.0
	var y := 0.0
	var z := 0.0
	var vx := 0.0
	var vy := 0.0
	var vz := 0.0
	var t := 0.0
	var life := 0.0
	var size := 0.0
	## the camera has already been shaken for it
	var shook := false
	## drawn this much larger
	var scale := 1.0


class Wreck:
	var key := ""
	var owner := 0
	var x := 0.0
	var y := 0.0
	var dir := 0.0
	var tdir := 0.0
	var t := 0.0
	var air := false
	var naval := false


class Msg:
	var text := ""
	var t := 0.0
	## info | warn | good
	var kind := "info"


## a ground mark waiting to be painted onto the terrain
class Stamp:
	## scorch | rubble
	var kind := ""
	var size := 0
	var x := 0.0
	var y := 0.0


## seed, faction ("nato"/"ru"), difficulty (0-2), mapType, tod, weather
var opts: Dictionary
var map: GameMap
var pf: PathFinder
## path finding on the water
var npf: PathFinder
var ents: Array[Ent] = []
## id -> Ent (living only)
var by_id: Dictionary = {}
var players: Array[Player] = []
var bdefs: Dictionary
var shots: Array[Shot] = []
## effects; expired Fx objects are recycled, do not keep references across ticks
var fx: Array[Fx] = []
var wrecks: Array[Wreck] = []
var msgs: Array[Msg] = []
var time := 0.0
var rand: Rng.Mulberry = Rng.mulberry32(12345)
## fog for the human player: 0 never seen, 1 seen before, 2 in sight now
var fog := PackedByteArray()
var fog_dirty := true
var _fog_t := 0.0
var _check_t := 0.0
## 0 running, 1 player 0 won, -1 player 0 lost
var over := 0
## ground marks waiting to be painted onto the terrain (the renderer empties it)
var stamps: Array[Stamp] = []
## ore tiles that ran dry (the renderer empties it)
var ore_changed: Array[int] = []
# spatial hash of ground units by tile
var _head := PackedInt32Array()
var _next := PackedInt32Array()
var _list: Array[Ent] = []
var alert_t := -99.0
## houses, the church, barns and bunkers soldiers can hold
var garrisons: Array[Garrison] = []
## tile index -> the garrison on it
var g_at: Dictionary = {}
var _gid := 1
## (event: String, x: float, y: float)
var on_sound: Callable = func(_n: String, _x: float, _y: float) -> void: pass
## debugging: lift the fog
var reveal := false

var me: Player:
	get:
		return players[0]

# rules (rules.json)
var start_credits := 5000.0
var harvest_load := 500.0
var build_radius := 5
var ranks: Array = [3, 7, 12]
var rank_names: Array = ["Rekrut", "Gefreiter", "Feldwebel", "Veteran"]
var cover := 0.3
var gspec: Dictionary = GSPEC_DEFAULT
var _mine_amount := 50.0
var _mine_interval := 0.5
var _unload_seconds := 2.2
var _sell_refund := 0.5
var _repair_seconds := 25.0
var _repair_share := 0.3
var _low_power_prod := 0.45
var _low_power_def := 0.5
var _extra_producer := 0.5
var _rise_seconds := 1.6
var _trickle := 8.0
var _trickle_below := 1000.0
var _dmg_bonus := 0.12
var _armor_bonus := 0.07
var _promote_heal := 0.25
var _vet_regen := 0.01
var _dmg_lo := 0.9
var _dmg_span := 0.2
var _splash_falloff := 0.6
var _rearm_seconds := 6.0
var _carrier_rebuild := 22.0
var _carrier_range := 17.0
var _spotted_within := 2.2
var _ai_prod: Array = [0.8, 1, 1.25]
var _ai_income: Array = [0.75, 1, 1.3]

## time per tick for the paths of big orders (set_dest_later), microseconds
var path_budget_us := 3000
## and for units chasing a target; past it they repath a tick later
var chase_budget_us := 3000
# path finding time spent in this tick
var _path_us := 0
# changes whenever a building goes up or comes down (what ground units can cross)
var _map_ver := 0
var _comp_land := PackedInt32Array()
var _comp_ver := -1
var _comp_sea := PackedInt32Array()

# damage table by class and armour index
var _vs := PackedFloat64Array()
# buildings (alive or dead until the next sweep), for fast lookups
var _blds: Array[Ent] = []
var _fx_pool: Array[Fx] = []
var _pq: Array[Ent] = []
var _pq_goal := PackedVector2Array()
var _lit := PackedInt32Array()
var _fog_full := true
# what each side sees, snapshotted at the start of a tick: position, sight, flags (1 building, 2 inside)
var _tick := 0
var _in_update := false
var _ox: Array[PackedFloat64Array] = [PackedFloat64Array(), PackedFloat64Array()]
var _oy: Array[PackedFloat64Array] = [PackedFloat64Array(), PackedFloat64Array()]
var _os: Array[PackedFloat64Array] = [PackedFloat64Array(), PackedFloat64Array()]
var _of: Array[PackedInt32Array] = [PackedInt32Array(), PackedInt32Array()]
# scratch results (jet_home, seg_closest)
var _jh_x := 0.0
var _jh_y := 0.0
var _jh_b: Ent = null
var _sc_ax := 0.0
var _sc_ay := 0.0
var _sc_bx := 0.0
var _sc_by := 0.0
var _sc_d := 0.0


func _init(opts_: Dictionary) -> void:
	opts = {
		"seed": int(opts_.get("seed", 1)), "faction": String(opts_.get("faction", "nato")),
		"difficulty": int(opts_.get("difficulty", 1)), "mapType": String(opts_.get("mapType", "land")),
		"tod": String(opts_.get("tod", "day")), "weather": String(opts_.get("weather", "clear")),
	}
	_load_rules()
	bdefs = Data.building_defs()
	map = GameMap.generate(opts.seed, opts.mapType)
	pf = PathFinder.new(map)
	npf = PathFinder.new(map, Callable(map, &"nav_i"))
	var NN := map.N * map.N
	fog.resize(NN)
	_head.resize(NN)
	var enemy := "ru" if opts.faction == "nato" else "nato"
	# the NATO side always starts in the west
	var factions: Array[String] = [opts.faction, enemy]
	for i in 2:
		var p := Player.new()
		p.id = i
		p.faction = factions[i]
		p.ai = i == 1
		p.credits = start_credits
		p.units = _playable(Data.unit_defs(p.faction))
		for q in QUEUES:
			p.queues[q] = []
		players.append(p)
	for i in 2:
		var p := players[i]
		var start: Vector2i = map.starts[0 if p.faction == "nato" else 1]
		var hq := add_building(i, "hq", start.x - 1, start.y - 1)
		hq.built = 1.0
		var sx := start.x + 0.5
		var sy := start.y + 0.5
		var toward := 1.0 if p.faction == "nato" else -1.0
		add_unit(i, "ifv", sx + toward * 3, sy - toward * 3)
		add_unit(i, "rifle", sx + toward * 2.4, sy + toward * 2.2)
		add_unit(i, "rifle", sx + toward * 2.9, sy + toward * 2.0)
		add_unit(i, "rifle", sx + toward * 2.6, sy + toward * 2.7)
	# every house of the villages can be held
	for st: Dictionary in map.statics:
		var k: String = st.kind
		var kind := "house" if k == "house" or k == "timber" else ("church" if k == "church" else ("barn" if k == "barn" else ""))
		if kind != "":
			add_garrison(kind, floori(st.x), floori(st.y), 1, 1, null)
	update_power()
	update_fog()


func _load_rules() -> void:
	var R: Dictionary = Data.rules
	start_credits = float(R.get("startCredits", 5000))
	harvest_load = float(R.get("harvestLoad", 500))
	build_radius = int(R.get("buildRadius", 5))
	_mine_amount = float(R.get("mineAmount", 50))
	_mine_interval = float(R.get("mineInterval", 0.5))
	_unload_seconds = float(R.get("unloadSeconds", 2.2))
	_sell_refund = float(R.get("sellRefund", 0.5))
	_repair_seconds = float(R.get("repairSeconds", 25))
	_repair_share = float(R.get("repairCostShare", 0.3))
	_low_power_prod = float(R.get("lowPowerProduction", 0.45))
	_low_power_def = float(R.get("lowPowerDefenseRate", 0.5))
	_extra_producer = float(R.get("extraProducerSpeed", 0.5))
	_rise_seconds = float(R.get("buildingRiseSeconds", 1.6))
	var bt: Dictionary = R.get("brokeTrickle", {})
	_trickle = float(bt.get("perSecond", 8))
	_trickle_below = float(bt.get("below", 1000))
	var rk: Dictionary = R.get("ranks", {})
	ranks = rk.get("kills", ranks)
	rank_names = rk.get("names", rank_names)
	_dmg_bonus = float(rk.get("damageBonus", 0.12))
	_armor_bonus = float(rk.get("armorBonus", 0.07))
	_promote_heal = float(rk.get("promoteHeal", 0.25))
	_vet_regen = float(rk.get("veteranRegen", 0.01))
	var dr: Array = R.get("damageRandom", [0.9, 1.1])
	_dmg_lo = float(dr[0])
	_dmg_span = float(dr[1]) - float(dr[0])
	_splash_falloff = float(R.get("splashFalloff", 0.6))
	_rearm_seconds = float(R.get("jetRearmSeconds", 6))
	_carrier_rebuild = float(R.get("carrierRebuildSeconds", 22))
	_carrier_range = float(R.get("carrierStrikeRange", 17))
	Ent.hide_after = float(R.get("sniperHideAfter", 2.5))
	_spotted_within = float(R.get("sniperSpottedWithin", 2.2))
	var ad: Dictionary = R.get("aiDifficulty", {})
	_ai_prod = ad.get("production", _ai_prod)
	_ai_income = ad.get("income", _ai_income)
	gspec = R.get("garrison", GSPEC_DEFAULT)
	cover = float(R.get("cover", 0.3))
	_vs.resize(WCLASSES.size() * ARMORS.size())
	for c in WCLASSES.size():
		for a in ARMORS.size():
			_vs[c * ARMORS.size() + a] = Data.vs(WCLASSES[c], ARMORS[a])


## the units the prototype can build (planned ones are left out, as in the browser game)
static func _playable(defs: Dictionary) -> Dictionary:
	var out := {}
	for k: String in defs:
		if not defs[k].get("planned", false):
			out[k] = defs[k]
	return out


func add_garrison(kind: String, tx: int, ty: int, w: int, h: int, b: Ent) -> Garrison:
	var sp: Dictionary = gspec[kind]
	var g := Garrison.new()
	g.id = _gid
	_gid += 1
	g.kind = kind
	g.name = sp.name
	g.x = tx + w / 2.0
	g.y = ty + h / 2.0
	g.tx = tx
	g.ty = ty
	g.w = w
	g.h = h
	g.cap = int(b.b.get("garrison", sp.cap)) if kind == "bunker" and b != null else int(sp.cap)
	g.owner = b.owner if b != null else -1
	g.range = float(sp.range)
	g.sight = float(sp.sight)
	g.b = b
	garrisons.append(g)
	for y in range(ty, ty + h):
		for x in range(tx, tx + w):
			g_at[map.idx(x, y)] = g
	return g


func garrison_at(x: float, y: float) -> Garrison:
	var tx := floori(x)
	var ty := floori(y)
	if not map.in_map(tx, ty):
		return null
	return g_at.get(map.idx(tx, ty))


func garrison_of(b: Ent) -> Garrison:
	for g in garrisons:
		if g.b == b:
			return g
	return null


## can this player's soldiers go in
func can_enter(p: int, g: Garrison) -> bool:
	if g.b != null and (g.b.dead or g.b.owner != p or g.b.built < 1):
		return false
	if g.occ.size() > 0 and g.owner != p:
		return false
	return g.occ.size() < g.cap


## distance from a unit to the walls of a garrison
func g_dist(u: Ent, g: Garrison) -> float:
	var dx := maxf(maxf(g.tx - u.x, 0.0), u.x - (g.tx + g.w))
	var dy := maxf(maxf(g.ty - u.y, 0.0), u.y - (g.ty + g.h))
	return Rng.hypot(dx, dy)


## soldiers walk to a house (or one of our bunkers) and go in
func command_garrison(units: Array, g: Garrison) -> void:
	var troops: Array[Ent] = []
	for u: Ent in units:
		if not u.is_b and not u.dead and u.infantry and u.carried_by == null and not u.u.get("engineer", false) and u.inside != g:
			troops.append(u)
	if troops.is_empty():
		return
	if not can_enter(troops[0].owner, g):
		msg(("%s ist voll" if g.occ.size() >= g.cap else "%s ist vom Feind besetzt") % g.name, "warn", troops[0].owner)
		return
	command_exit(troops.filter(func(u: Ent) -> bool: return u.inside != null))
	for u in troops:
		u.order = "enter"
		u.enter_g = g
		u.target = null
		u.amove = null
		u.guard = null
		u.board_on = null
		u.repath_t = 0.0
		_walk_to(u, g.tx, g.ty, g.w, g.h)


## head for the nearest open ground beside a house or building
func _walk_to(u: Ent, gtx: int, gty: int, gw: int, gh: int) -> void:
	var found := false
	var bx := 0
	var by := 0
	var bd := 1e9
	for y in range(gty - 1, gty + gh + 1):
		for x in range(gtx - 1, gtx + gw + 1):
			if x >= gtx and x < gtx + gw and y >= gty and y < gty + gh:
				continue
			if not pf.ok(x, y):
				continue
			var d := Rng.hypot(x + 0.5 - u.x, y + 0.5 - u.y)
			if d < bd:
				bd = d
				bx = x
				by = y
				found = true
	if found:
		set_dest(u, bx + 0.5, by + 0.5)
	else:
		set_dest(u, gtx + gw / 2.0, gty + gh / 2.0)


func _enter(u: Ent, g: Garrison) -> void:
	u.order = "idle"
	u.enter_g = null
	if not can_enter(u.owner, g):
		msg(("%s ist voll" if g.occ.size() >= g.cap else "%s ist vom Feind besetzt") % g.name, "warn", u.owner)
		u.guard = Vector2(u.x, u.y)
		return
	if g.occ.is_empty() and g.owner != u.owner and u.owner == 0:
		msg("%s besetzt" % g.name, "good")
	g.occ.append(u)
	g.owner = u.owner
	u.inside = g
	u.x = g.x
	u.y = g.y
	u.path = PackedInt32Array()
	u.dest = null
	u.target = null
	u.moving = false
	u.speed_now = 0.0
	u.guard = null
	on_sound.call("board", u.x, u.y)


## everyone out onto the ground round the house
func command_exit(units: Array) -> void:
	for u: Ent in units:
		var g := u.inside
		if g == null:
			continue
		_leave(u, g)


func _leave(u: Ent, g: Garrison) -> void:
	var i := g.occ.find(u)
	if i >= 0:
		g.occ.remove_at(i)
	if g.occ.is_empty() and g.b == null:
		g.owner = -1
	u.inside = null
	# the nearest free ground; soldiers spread round the door
	var keys := PackedFloat64Array()
	var spots: Array[Vector2i] = []
	for y in range(g.ty - 1, g.ty + g.h + 1):
		for x in range(g.tx - 1, g.tx + g.w + 1):
			if x >= g.tx and x < g.tx + g.w and y >= g.ty and y < g.ty + g.h:
				continue
			if pf.ok(x, y):
				spots.append(Vector2i(x, y))
				keys.append(Rng.hypot(x + 0.5 - g.x, y + 1.5 - g.y) + rand.next() * 0.6)
	var s := Vector2i(-1, -1)
	if spots.size() > 0:
		s = spots[sort_order(keys)[0]]
	else:
		s = pf.nearest_walkable(g.x, g.y)
	if s.x >= 0:
		u.x = s.x + 0.3 + rand.next() * 0.4
		u.y = s.y + 0.3 + rand.next() * 0.4
	u.order = "idle"
	u.target = null
	u.path = PackedInt32Array()
	u.dest = null
	u.guard = Vector2(u.x, u.y)


## engineers walk to an enemy building and take it over
func command_capture(units: Array, b: Ent) -> void:
	for u: Ent in units:
		if u.dead or u.is_b or not u.u.get("engineer", false) or u.carried_by != null:
			continue
		u.order = "capture"
		u.capture_b = b
		u.target = null
		u.amove = null
		u.guard = null
		u.repath_t = 0.0
		_walk_to(u, b.tx, b.ty, b.w, b.h)


func _capture(u: Ent, b: Ent) -> void:
	var was := b.owner
	# whoever was in a bunker gets out first
	var g := garrison_of(b)
	if g != null:
		for o in g.occ.duplicate():
			_leave(o, g)
		g.owner = u.owner
	b.owner = u.owner
	b.selected = false
	b.rally = null
	b.repairing = false
	b.target = null
	b.tdir = -PI / 4 if players[u.owner].faction == "nato" else PI * 0.75
	var pl := players[was]
	for q: String in pl.primary.keys():
		if pl.primary[q] == b.id:
			pl.primary.erase(q)
	# the engineer stays inside to run it
	u.dead = true
	u.selected = false
	by_id.erase(u.id)
	players[u.owner].stats.built += 1
	update_power()
	add_fx("spark", b.x, b.y, 14, 0, 0, 10, 0.5, 1)
	on_sound.call("capture", b.x, b.y)
	if u.owner == 0:
		msg("%s erobert!" % b.b.name, "good")
	elif was == 0:
		msg("%s wurde vom Feind erobert!" % b.b.name, "warn")


## how far a unit shoots, with the bonus from the house it holds
func range_of(u: Ent) -> float:
	if not u.has_wp:
		return 0.0
	if u.is_b:
		var g := garrison_of(u) if u.key == "bunker" else null
		return u.w_range + (0.5 if g != null and g.occ.size() > 0 else 0.0)
	return u.w_range + (u.inside.range if u.inside != null else 0.0)


func enemy_of(p: int) -> int:
	return 1 if p == 0 else 0


func msg(text: String, kind: String = "info", player: int = 0) -> void:
	if player != 0:
		return
	if msgs.size() > 0 and msgs[-1].text == text and time - msgs[-1].t < 3:
		return
	var m := Msg.new()
	m.text = text
	m.t = time
	m.kind = kind
	msgs.append(m)
	if msgs.size() > 6:
		msgs.remove_at(0)


# ─────────────────────────────────────────────────────── creating things

func add_unit(owner: int, key: String, x: float, y: float) -> Ent:
	var def: Dictionary = players[owner].units[key]
	var e := Ent.new(owner, key, def, false)
	e.x = x
	e.y = y
	e.dir = -PI / 4 if players[owner].faction == "nato" else PI * 0.75
	e.tdir = e.dir
	ents.append(e)
	by_id[e.id] = e
	if def.get("harvester", false):
		e.hs = "toOre"
	if e.is_air and not e.is_jet:
		e.order = "move"
	if def.get("carrier", 0):
		e.planes = int(def.carrier)
	return e


func add_building(owner: int, key: String, tx: int, ty: int) -> Ent:
	var def: Dictionary = bdefs[key]
	var e := Ent.new(owner, key, def, true)
	e.tx = tx
	e.ty = ty
	e.w = int(def.w)
	e.h = int(def.h)
	e.x = tx + e.w / 2.0
	e.y = ty + e.h / 2.0
	e.built = 0.0
	e.tdir = -PI / 4 if players[owner].faction == "nato" else PI * 0.75
	for y in range(ty, ty + e.h):
		for x in range(tx, tx + e.w):
			map.bld[map.idx(x, y)] = e.id
	_map_ver += 1
	ents.append(e)
	by_id[e.id] = e
	_blds.append(e)
	if def.get("garrison", 0):
		add_garrison("bunker", tx, ty, e.w, e.h, e)
	# anyone standing there steps aside
	for u in ents:
		if u.is_b or u.is_air or u.dead:
			continue
		if u.x >= tx - 0.3 and u.x < tx + e.w + 0.3 and u.y >= ty - 0.3 and u.y < ty + e.h + 0.3:
			var w := pf.nearest_walkable(u.x, u.y)
			if w.x >= 0:
				u.x = w.x + 0.5
				u.y = w.y + 0.5
				u.path = PackedInt32Array()
	update_power()
	return e


func has_building(p: int, key: String) -> bool:
	for e in _blds:
		if not e.dead and e.owner == p and e.key == key and e.built >= 1:
			return true
	return false


## what is missing before something can be built
func missing(p: int, req: Array) -> Array[String]:
	var out: Array[String] = []
	for k: String in req:
		if not has_building(p, k):
			out.append(k)
	return out


func can_place(p: int, key: String, tx: int, ty: int) -> bool:
	var def: Dictionary = bdefs[key]
	var dw := int(def.w)
	var dh := int(def.h)
	var m := map
	# (the prototype's checks in a cheaper order; all must pass, so the answer is the same)
	for y in range(ty, ty + dh):
		for x in range(tx, tx + dw):
			if not m.buildable(x, y):
				return false
	# a shipyard needs open water along its side
	if def.get("shore", false) and shore_tiles(tx, ty, dw, dh) < 3:
		return false
	# close enough to a building of our own
	var reach := int(def.get("reach", build_radius))
	var near := false
	for e in _blds:
		if e.dead or e.owner != p:
			continue
		var dx := maxi(maxi(e.tx - (tx + dw), tx - (e.tx + e.w)), 0)
		var dy := maxi(maxi(e.ty - (ty + dh), ty - (e.ty + e.h)), 0)
		if maxi(dx, dy) <= reach:
			near = true
			break
	if not near:
		return false
	for u in ents:
		if u.is_b or u.dead or u.is_air or u.owner == p:
			continue
		var ux := floori(u.x)
		var uy := floori(u.y)
		if ux >= tx and ux < tx + dw and uy >= ty and uy < ty + dh:
			return false
	return true


## how many water tiles touch the edge of a footprint
func shore_tiles(tx: int, ty: int, w: int, h: int) -> int:
	var n := 0
	for y in range(ty - 1, ty + h + 1):
		for x in range(tx - 1, tx + w + 1):
			if x >= tx and x < tx + w and y >= ty and y < ty + h:
				continue
			if map.nav(x, y):
				n += 1
	return n


# ─────────────────────────────────────────────────────── production

func queue_item(p: int, q: String, key: String) -> bool:
	var pl := players[p]
	var list: Array = pl.queues[q]
	if list.size() >= (1 if q == "build" else 9):
		return false
	var def: Variant = bdefs.get(key) if q == "build" else pl.units.get(key)
	if def == null or missing(p, def.req).size() > 0:
		return false
	list.append(QItem.new(key))
	return true


func cancel_item(p: int, q: String, key: String) -> void:
	var list: Array = players[p].queues[q]
	for i in range(list.size() - 1, -1, -1):
		var it: QItem = list[i]
		if it.key == key:
			players[p].credits += it.paid
			list.remove_at(i)
			return


func place_ready(p: int, tx: int, ty: int) -> bool:
	var list: Array = players[p].queues["build"]
	if list.is_empty():
		return false
	var it: QItem = list[0]
	if not it.ready:
		return false
	if not can_place(p, it.key, tx, ty):
		return false
	list.remove_at(0)
	add_building(p, it.key, tx, ty)
	players[p].stats.built += 1
	on_sound.call("place", tx, ty)
	return true


func _produce(dt: float) -> void:
	for pl in players:
		if not pl.alive:
			continue
		var low := pl.power_use > pl.power_prod
		for q in QUEUES:
			var list: Array = pl.queues[q]
			if list.is_empty():
				continue
			var it: QItem = list[0]
			if it.ready:
				continue
			var prod: String = "hq" if q == "build" else String(pl.units[it.key].producer)
			var n := 0
			for e in _blds:
				if not e.dead and e.owner == pl.id and e.key == prod and e.built >= 1:
					n += 1
			if n == 0:
				continue
			var def: Dictionary = bdefs[it.key] if q == "build" else pl.units[it.key]
			var speed := (1 + _extra_producer * (n - 1)) * (_low_power_prod if low else 1.0)
			if pl.ai:
				speed *= float(_ai_prod[opts.difficulty])
			var dp := minf(1 - it.progress, (dt * speed) / float(def.time))
			var cost := dp * float(def.cost)
			if pl.credits < cost:
				if pl.id == 0 and floori(time) % 10 == 0:
					msg("Nicht genug Rohstoffe", "warn")
				continue
			pl.credits -= cost
			it.paid += cost
			it.progress += dp
			if it.progress >= 0.9999:
				if q == "build":
					it.ready = true
					msg("%s bereit zum Platzieren" % def.name, "good", pl.id)
					on_sound.call("ready", 0.0, 0.0)
				elif _spawn_from(pl, q, it.key):
					list.remove_at(0)


## where a unit leaves a building
func exit_of(b: Ent) -> Vector2:
	var w := pf.nearest_walkable(b.tx + b.w / 2.0, b.ty + b.h + 0.6, 6)
	return Vector2(w.x + 0.5, w.y + 0.5) if w.x >= 0 else Vector2(b.x, b.y + b.h)


## where a parked jet stands on an airfield
func slot_pos(b: Ent, s: int) -> Vector2:
	return Vector2(b.tx + 0.6 + s * 1.125, b.ty + 2.25)


## a free parking spot on one of a player's airfields, the nearest first: [airfield, slot] or []
func free_slot(owner: int, near: Ent = null) -> Array:
	var best: Array = []
	var bd := 1e9
	for b in _blds:
		if b.dead or b.owner != owner or b.key != "airfield" or b.built < 1:
			continue
		var used := {}
		for j in ents:
			if j.is_jet and not j.dead and j.home == b.id:
				used[j.slot] = true
		for s in int(b.b.get("slots", 3)):
			if used.has(s):
				continue
			var d := Rng.hypot(b.x - near.x, b.y - near.y) if near != null else 0.0
			if d < bd:
				bd = d
				best = [b, s]
			break
	return best


func _spawn_from(pl: Player, q: String, key: String) -> bool:
	var def: Dictionary = pl.units[key]
	var prod: String = def.producer
	var b: Ent = null
	var last: Ent = null
	var want: int = pl.primary.get(q, -1)
	for e in ents:
		if e.is_b and not e.dead and e.owner == pl.id and e.key == prod and e.built >= 1:
			if b == null and e.id == want:
				b = e
			last = e
	if last == null:
		return false
	if b == null:
		b = last
	var u: Ent
	if def.get("jet", false):
		var spot := free_slot(pl.id, b)
		if spot.is_empty():
			if floori(time) % 15 == 0:
				msg("Alle Stellplätze auf dem Flugfeld belegt", "warn", pl.id)
			return false
		var p := slot_pos(spot[0], spot[1])
		u = add_unit(pl.id, key, p.x, p.y)
		u.home = spot[0].id
		u.slot = spot[1]
		u.dir = PI / 2
		u.tdir = u.dir
		u.js = "park"
		u.ammo = 1
		msg("%s bereit" % def.name, "good", pl.id)
		return true
	if def.get("naval", false):
		var w := npf.nearest_walkable(b.x, b.y, 8)
		if w.x < 0:
			return false
		u = add_unit(pl.id, key, w.x + 0.5, w.y + 0.5)
		var out := npf.nearest_walkable(w.x + (w.x - b.x) * 0.6, w.y + (w.y - b.y) * 0.6, 6)
		if out.x < 0:
			out = w
		u.dir = atan2(out.y - w.y, out.x - w.x)
		u.tdir = u.dir
		if b.rally != null:
			command_move([u], b.rally.x, b.rally.y, false)
		else:
			command_move([u], out.x + 0.5, out.y + 0.5, false)
		msg("%s bereit" % def.name, "good", pl.id)
		if pl.id == 0:
			on_sound.call("unit", u.x, u.y)
		return true
	if def.get("air", false):
		u = add_unit(pl.id, key, b.x, b.y)
	else:
		var ex := exit_of(b)
		u = add_unit(pl.id, key, ex.x, ex.y)
		u.dir = PI / 2 + 0.3
		u.tdir = u.dir
	if b.rally != null:
		command_move([u], b.rally.x, b.rally.y, false)
	elif def.get("air", false):
		command_move([u], b.x + 1.5, b.y + 1.5, false)
	elif not def.get("harvester", false):
		command_move([u], u.x + 0.8, u.y + 1.6, false)
	if def.get("harvester", false):
		u.hs = "toOre"
		u.order = "harvest"
	msg("%s bereit" % def.name, "good", pl.id)
	if pl.id == 0:
		on_sound.call("unit", u.x, u.y)
	return true


func update_power() -> void:
	for pl in players:
		pl.power_prod = 0
		pl.power_use = 0
	for e in _blds:
		if e.dead or e.built < 1:
			continue
		var pw := float(e.b.power)
		var pl := players[e.owner]
		if pw > 0:
			pl.power_prod += int(Rng.js_round(pw * (0.5 + 0.5 * e.hp / e.max_hp)))
		else:
			pl.power_use -= int(pw)


func sell(e: Ent) -> void:
	if not e.is_b or e.dead or e.key == "hq":
		return
	var pl := players[e.owner]
	pl.credits += Rng.js_round(float(e.b.cost) * _sell_refund * (e.hp / e.max_hp))
	remove_building(e, false)
	on_sound.call("sell", e.x, e.y)


# ─────────────────────────────────────────────────────── orders

## send units to a place, spread out so they do not all fight for one tile
func command_move(units: Array, x: float, y: float, attack_move: bool) -> void:
	var live: Array[Ent] = []
	for u: Ent in units:
		if not u.is_b and not u.dead and u.carried_by == null:
			live.append(u)
	var inside: Array[Ent] = []
	var ground: Array[Ent] = []
	var ships: Array[Ent] = []
	var airs: Array[Ent] = []
	var jets: Array[Ent] = []
	for u in live:
		if u.inside != null:
			inside.append(u)
		if not u.is_air and not u.is_naval:
			ground.append(u)
		if u.is_naval:
			ships.append(u)
		if u.is_air and not u.is_jet:
			airs.append(u)
		if u.is_jet:
			jets.append(u)
	command_exit(inside)
	if jets.size() > 0:
		command_strike(jets, null, x, y)
	# a loaded landing ship sent onto land puts its troops ashore there
	var tx := floori(x)
	var ty := floori(y)
	var on_land := map.walk(tx, ty) or (map.in_map(tx, ty) and map.bld[map.idx(tx, ty)] > 0)
	var sailing: Array[Ent] = []
	for sh in ships:
		if sh.passengers.size() > 0 and on_land:
			command_unload(sh, x, y)
	for sh in ships:
		if not (sh.passengers.size() > 0 and on_land):
			sailing.append(sh)
	_go(ground, formation(x, y, ground, false), x, y, attack_move)
	_go(sailing, formation(x, y, sailing, true), x, y, attack_move)
	var n := airs.size()
	for i in n:
		var u := airs[i]
		var a := (float(i) / maxi(1, n)) * PI * 2
		var r := 0.8 if n > 1 else 0.0
		u.dest = Vector2(x + cos(a) * r, y + sin(a) * r)
		u.path = PackedInt32Array()
		u.order = "amove" if attack_move else "move"
		if attack_move:
			u.amove = u.dest
		else:
			u.amove = null
		u.target = null
		u.guard = null


func _go(list: Array[Ent], slots: Array[Vector2], x: float, y: float, attack_move: bool) -> void:
	for i in list.size():
		var u := list[i]
		var s := slots[i] if i < slots.size() else Vector2(x, y)
		set_dest_later(u, s.x, s.y)
		u.order = "amove" if attack_move else "move"
		if attack_move:
			u.amove = s
		else:
			u.amove = null
		u.target = null
		u.guard = null
		u.board_on = null
		u.enter_g = null
		u.capture_b = null
		if u.u.get("harvester", false):
			u.hs = "idle"


func formation(x: float, y: float, units: Array[Ent], naval: bool) -> Array[Vector2]:
	var out: Array[Vector2] = []
	if units.is_empty():
		return out
	var m := map
	var pfn := npf if naval else pf
	# boats sent onto land go to the nearest water
	if naval and not m.nav(floori(x), floori(y)):
		var w := npf.nearest_walkable(x, y, 30)
		if w.x >= 0:
			x = w.x + 0.5
			y = w.y + 0.5
	var cx := floori(x)
	var cy := floori(y)
	var tiles: Array[Vector2i] = []
	var tkeys := PackedFloat64Array()
	var need := 0.0
	for u in units:
		var hull: Array = u.u.get("hull", [])
		need += 0.34 if u.infantry else (pow(2 * ceilf((float(hull[0]) if hull.size() > 0 else 1.0) * 0.6) + 1, 2) if u.is_naval else (3.0 if u.radius > 0.7 else 1.0))
	var rmax := 22 if naval else 16
	var r := 0
	while r < rmax and tiles.size() < need * 1.6 + 1:
		for dy in range(-r, r + 1):
			for dx in range(-r, r + 1):
				if maxi(absi(dx), absi(dy)) != r:
					continue
				if not pfn.ok(cx + dx, cy + dy):
					continue
				tiles.append(Vector2i(cx + dx, cy + dy))
				tkeys.append(Rng.hypot(dx, dy))
		r += 1
	var tord := sort_order(tkeys)
	# vehicles take whole tiles; soldiers share them three to a tile; big ships keep a tile clear round them
	out.resize(units.size())
	var done := PackedByteArray()
	done.resize(units.size())
	var ukeys := PackedFloat64Array()
	for u in units:
		ukeys.append(Rng.hypot(u.x - x, u.y - y))
	var fill := {}
	for i in sort_order(ukeys):
		var ui := units[i]
		var inf := ui.infantry
		var big := ui.radius > 0.7
		# a ship needs clear water for its whole hull
		var hull: Array = ui.u.get("hull", [])
		var rr := (maxi(1, ceili((float(hull[0]) if hull.size() > 0 else ui.radius) * 0.6)) if naval else (1 if big else 0))
		for ti in tord:
			var t := tiles[ti]
			var k := m.idx(t.x, t.y)
			var used: int = fill.get(k, 0)
			var free := false
			if inf:
				free = used < 3 and used != -1
			elif used == 0:
				free = true
				if naval:
					for dy in range(-rr, rr + 1):
						for dx in range(-rr, rr + 1):
							if fill.get(m.idx(clampi(t.x + dx, 0, m.N - 1), clampi(t.y + dy, 0, m.N - 1)), 0) != 0:
								free = false
			if free:
				var o: Vector2 = OFF[used + 1] if inf else OFF[0]
				out[i] = Vector2(t.x + o.x, t.y + o.y)
				done[i] = 1
				fill[k] = used + 1 if inf else -1
				if rr:
					for dy in range(-rr, rr + 1):
						for dx in range(-rr, rr + 1):
							if m.in_map(t.x + dx, t.y + dy):
								fill[m.idx(t.x + dx, t.y + dy)] = -1
				break
		if not done[i]:
			out[i] = Vector2(x, y)
	return out


func pf_of(u: Ent) -> PathFinder:
	return npf if u.is_naval else pf


func set_dest(u: Ent, x: float, y: float) -> void:
	var pfn := npf if u.is_naval else pf
	u.path_wait = false
	u.dest = Vector2(x, y)
	var from := map.idx(floori(u.x), floori(u.y))
	var to := map.idx(floori(x), floori(y))
	if u.pm_from == from and u.pm_to == to and u.pm_ver == _map_ver:
		# the same request as last time on the same map: the same answer (a unit that cannot get
		# closer to its target asks every tick)
		u.path = u.pm_path
	else:
		var t0 := Time.get_ticks_usec()
		u.path = pfn.find(floori(u.x), floori(u.y), floori(x), floori(y), _max_nodes(u.is_naval, from, floori(x), floori(y)))
		_path_us += Time.get_ticks_usec() - t0
		u.pm_from = from
		u.pm_to = to
		u.pm_ver = _map_ver
		u.pm_path = u.path
	u.pi = 0
	u.repaths = 0
	u.stuck_t = 0.0
	# the last step goes to the exact place, not the tile's middle
	var n := u.path.size()
	if n > 0 and u.path[n - 1] == map.idx(floori(x), floori(y)):
		u.dest = Vector2(x, y)
	elif n > 0:
		var last := u.path[n - 1]
		@warning_ignore("integer_division")
		u.dest = Vector2((last % map.N) + 0.5, (last / map.N) + 0.5)
	else:
		u.dest = null


## How far the path finder may search. A goal the unit cannot reach at all (another island, the
## far side of the water) makes it search everything it can reach for the closest point, up to
## 6000 tiles: fast enough in the browser, but ~20 ms here, and a chasing unit asks every second.
## Such searches stop after UNREACHABLE_NODES; reachable goals get the full search as before.
func _max_nodes(naval: bool, from: int, gx: int, gy: int) -> int:
	var N := map.N
	gx = clampi(gx, 0, N - 1)
	gy = clampi(gy, 0, N - 1)
	var comp := _components(naval)
	var to := map.idx(gx, gy)
	if comp[to] < 0:
		var w := (npf if naval else pf).nearest_walkable(gx + 0.5, gy + 0.5)
		if w.x < 0:
			return 6000
		to = map.idx(w.x, w.y)
	if comp[from] < 0 or comp[from] == comp[to]:
		return 6000
	return UNREACHABLE_NODES


## which connected piece of land (or water) each tile belongs to, -1 where nothing can go
func _components(naval: bool) -> PackedInt32Array:
	if naval:
		if _comp_sea.is_empty():
			_comp_sea = _label(true)
		return _comp_sea
	if _comp_ver != _map_ver:
		_comp_land = _label(false)
		_comp_ver = _map_ver
	return _comp_land


func _label(naval: bool) -> PackedInt32Array:
	var m := map
	var N := m.N
	var n := N * N
	var comp := PackedInt32Array()
	comp.resize(n)
	var ter := m.ter
	var block := m.block
	var bld := m.bld
	for i in n:
		var ok := (ter[i] == GameMap.WATER or ter[i] == GameMap.BRIDGE) if naval else (block[i] == 0 and bld[i] == 0)
		comp[i] = -2 if ok else -1
	var stack := PackedInt32Array()
	var label := 0
	for i in n:
		if comp[i] != -2:
			continue
		comp[i] = label
		stack.append(i)
		while not stack.is_empty():
			var c := stack[stack.size() - 1]
			stack.resize(stack.size() - 1)
			var cx := c % N
			if cx > 0 and comp[c - 1] == -2:
				comp[c - 1] = label
				stack.append(c - 1)
			if cx < N - 1 and comp[c + 1] == -2:
				comp[c + 1] = label
				stack.append(c + 1)
			if c >= N and comp[c - N] == -2:
				comp[c - N] = label
				stack.append(c - N)
			if c < n - N and comp[c + N] == -2:
				comp[c + N] = label
				stack.append(c + N)
		label += 1
	return comp


## set_dest for orders to many units at once: the unit gets its goal now and its path within the
## next ticks (the path finder is slow in GDScript, so a big order is spread over a few ticks).
## Until then it stands still with `dest` set and an empty `path`.
func set_dest_later(u: Ent, x: float, y: float) -> void:
	u.dest = Vector2(x, y)
	u.path = PackedInt32Array()
	u.pi = 0
	u.repaths = 0
	u.stuck_t = 0.0
	u.path_wait = true
	_pq.append(u)
	_pq_goal.append(Vector2(x, y))


## works through the waiting path requests: at least one, then as many as fit in the budget
func _run_paths() -> void:
	if _pq.is_empty():
		return
	var t0 := Time.get_ticks_usec()
	var k := 0
	var last := 0
	while k < _pq.size():
		var u := _pq[k]
		var goal := _pq_goal[k]
		if u.path_wait and not u.dead and u.dest == goal and u.path.is_empty():
			# another one only if it is likely to fit (paths across the map take a few ms)
			var now := Time.get_ticks_usec()
			if k > 0 and now - t0 + last > path_budget_us:
				break
			set_dest(u, goal.x, goal.y)
			last = Time.get_ticks_usec() - now
		k += 1
	if k >= _pq.size():
		_pq.clear()
		_pq_goal.clear()
	else:
		_pq = _pq.slice(k)
		_pq_goal = _pq_goal.slice(k)


## is there time left for another path this tick (for repaths that can wait a tick)
func _path_room() -> bool:
	return _path_us < path_budget_us + chase_budget_us


func command_attack(units: Array, t: Ent) -> void:
	var jets: Array[Ent] = []
	for u: Ent in units:
		if u.is_jet:
			jets.append(u)
	if jets.size() > 0:
		command_strike(jets, t, t.x, t.y)
	for u: Ent in units:
		if u.is_b or u.dead or not u.has_wp or u.is_jet or u.carried_by != null:
			continue
		if not can_hit(u, t):
			continue
		if u.inside != null and dist(u, t) > range_of(u):
			continue
		u.order = "attack"
		u.target = t
		u.amove = null
		u.guard = null
		u.path = PackedInt32Array()
		u.dest = null
		u.repath_t = 0.0


## jets fly a strike at a target or a point, if they have weapons on board
func command_strike(jets: Array, t: Ent, x: float, y: float) -> void:
	var rearming := false
	for j: Ent in jets:
		if not j.is_jet or j.dead:
			continue
		if j.ammo < 1:
			rearming = true
			continue
		j.strike = Ent.Strike.new(t, x, y)
		j.order = "strike"
		j.js = "out"
	if rearming and jets.size() > 0 and jets[0].owner == 0:
		msg("Jets werden noch aufmunitioniert", "warn")


func command_stop(units: Array) -> void:
	for u: Ent in units:
		if u.is_b or u.is_jet:
			continue
		u.order = "idle"
		u.target = null
		u.path = PackedInt32Array()
		u.dest = null
		u.amove = null
		u.board_on = null
		u.enter_g = null
		u.capture_b = null
		if u.inside != null:
			u.guard = null
		else:
			u.guard = Vector2(u.x, u.y)
		if u.u.get("harvester", false):
			u.hs = "idle"


func command_harvest(units: Array, tile: int) -> void:
	for u: Ent in units:
		if u.is_b or not u.u.get("harvester", false):
			continue
		u.order = "harvest"
		u.ore_tile = tile
		u.hs = "toOre"
		u.path = PackedInt32Array()
		u.dest = null
		var tx := tile % map.N
		@warning_ignore("integer_division")
		var ty := tile / map.N
		set_dest(u, tx + 0.5, ty + 0.5)


func command_return(units: Array) -> void:
	for u: Ent in units:
		if u.is_b or not u.u.get("harvester", false):
			continue
		u.order = "harvest"
		u.hs = "toRef"
		u.path = PackedInt32Array()
		u.dest = null


## ground units walk to a landing ship and go aboard; the ship comes to the nearest shore to meet them
func command_board(units: Array, ship: Ent) -> void:
	var troops: Array[Ent] = []
	for u: Ent in units:
		if not u.is_b and not u.dead and not u.is_air and not u.is_naval and u.carried_by == null:
			troops.append(u)
	if troops.is_empty():
		return
	command_exit(troops.filter(func(u: Ent) -> bool: return u.inside != null))
	var cx := 0.0
	var cy := 0.0
	for u in troops:
		cx += u.x
	for u in troops:
		cy += u.y
	cx /= troops.size()
	cy /= troops.size()
	# meet halfway between the troops and the ship, at the water's edge
	var sp: Variant = shore_point(cx + (ship.x - cx) * 0.25, cy + (ship.y - cy) * 0.25)
	if sp != null:
		set_dest(ship, sp.water.x, sp.water.y)
		ship.order = "move"
	for u in troops:
		u.order = "board"
		u.board_on = ship
		u.target = null
		u.path = PackedInt32Array()
		u.dest = null
		u.repath_t = 0.0
		if sp != null:
			set_dest(u, sp.land.x, sp.land.y)
		u.repath_t = 2.0
		if u.u.get("harvester", false):
			u.hs = "idle"


## a water tile at the shore nearest a point, and the land tile beside it:
## {water: Vector2, land: Vector2} or null
func shore_point(x: float, y: float, max_r: int = 24) -> Variant:
	var m := map
	var cx := floori(x)
	var cy := floori(y)
	for r in max_r + 1:
		var found := false
		var bw := Vector2()
		var bl := Vector2()
		var bd := 1e9
		for dy in range(-r, r + 1):
			for dx in range(-r, r + 1):
				if maxi(absi(dx), absi(dy)) != r:
					continue
				var wx := cx + dx
				var wy := cy + dy
				if not m.nav(wx, wy) or m.ter[m.idx(wx, wy)] == GameMap.BRIDGE:
					continue
				for nd in DIRS4:
					var lx := wx + nd.x
					var ly := wy + nd.y
					if not m.walk(lx, ly) or m.ter[m.idx(lx, ly)] == GameMap.BRIDGE:
						continue
					var d := Rng.hypot(dx, dy)
					if d < bd:
						bd = d
						bw = Vector2(wx + 0.5, wy + 0.5)
						bl = Vector2(lx + 0.5, ly + 0.5)
						found = true
		if found:
			return {"water": bw, "land": bl}
	return null


## a landing ship takes its troops to the shore nearest a point (or puts them ashore right here)
func command_unload(ship: Ent, x: Variant = null, y: Variant = null) -> void:
	if ship.passengers.is_empty():
		return
	if x == null or y == null:
		if not _unload_here(ship, null):
			msg("Zu weit vom Ufer zum Entladen", "warn", ship.owner)
		return
	var sp: Variant = shore_point(x, y, 14)
	if sp == null:
		msg("Dort ist kein Ufer zum Anlanden", "warn", ship.owner)
		return
	var best: Vector2 = sp.water
	set_dest(ship, best.x, best.y)
	ship.order = "unload"
	ship.unload_at = Vector2(x, y)


func _board(u: Ent, ship: Ent) -> void:
	var cap := int(ship.u.get("transport", 0)) if not ship.is_b else 0
	u.order = "idle"
	u.board_on = null
	if ship.passengers.size() >= cap:
		msg("Das Landungsschiff ist voll", "warn", u.owner)
		return
	ship.passengers.append(u)
	u.carried_by = ship
	u.selected = false
	u.path = PackedInt32Array()
	u.dest = null
	u.target = null
	on_sound.call("board", u.x, u.y)


## everyone off onto the nearest land; returns false if there is none in reach
func _unload_here(ship: Ent, goal: Variant) -> bool:
	var m := map
	var spots: Array[Vector2i] = []
	var keys := PackedFloat64Array()
	var cx := floori(ship.x)
	var cy := floori(ship.y)
	for dy in range(-3, 4):
		for dx in range(-3, 4):
			var x := cx + dx
			var y := cy + dy
			if not m.walk(x, y) or m.ter[m.idx(x, y)] == GameMap.BRIDGE:
				continue
			var d := Rng.hypot(x + 0.5 - ship.x, y + 0.5 - ship.y)
			if d < 3.2:
				spots.append(Vector2i(x, y))
				keys.append(d)
	if spots.is_empty():
		return false
	var order_ := sort_order(keys)
	var out: Array[Ent] = ship.passengers.duplicate()
	ship.passengers.clear()
	for i in out.size():
		var u := out[i]
		@warning_ignore("integer_division")
		var s := spots[order_[mini(spots.size() - 1, i / (3 if u.infantry else 1))]]
		u.carried_by = null
		u.x = s.x + 0.3 + rand.next() * 0.4
		u.y = s.y + 0.3 + rand.next() * 0.4
		u.order = "idle"
		u.guard = Vector2(u.x, u.y)
	if goal != null:
		command_move(out, goal.x, goal.y, false)
	on_sound.call("unload", ship.x, ship.y)
	return true


func can_hit(u: Ent, t: Ent) -> bool:
	if not u.has_wp or t.dead or t.carried_by != null:
		return false
	return u.reaches(t)


# ─────────────────────────────────────────────────────── the tick

func update(dt: float) -> void:
	if over != 0:
		return
	time += dt
	_tick += 1
	_in_update = true
	_path_us = 0
	_produce(dt)
	_run_paths()
	_build_spatial()
	_snap_sight()
	var i := 0
	while i < ents.size():
		var e := ents[i]
		if not e.dead:
			if e.is_b:
				_update_building(e, dt)
			else:
				_update_unit(e, dt)
		i += 1
	_separate(dt)
	_update_shots(dt)
	_update_fx(dt)
	# forget the dead
	var k := 0
	var n := ents.size()
	for j in n:
		var e := ents[j]
		if not e.dead:
			if k != j:
				ents[k] = e
			k += 1
		else:
			_forget(e)
	if k != n:
		ents.resize(k)
		var kb := 0
		for e in _blds:
			if not e.dead:
				_blds[kb] = e
				kb += 1
		_blds.resize(kb)
	for wi in range(wrecks.size() - 1, -1, -1):
		var w := wrecks[wi]
		w.t += dt
		if w.t < 14 and rand.next() < dt * 2.2:
			add_fx("smoke", w.x, w.y, 6, 0, 0, 10 + rand.next() * 6, 2.5, 3)
		if w.t < 6 and rand.next() < dt * 5:
			add_fx("fire", w.x + (rand.next() - 0.5) * 0.3, w.y + (rand.next() - 0.5) * 0.3, 4, 0, 0, 0, 0.6, 1)
		if w.naval and rand.next() < dt * 6:
			add_fx("wake", w.x + (rand.next() - 0.5), w.y + (rand.next() - 0.5), 0, 0, 0, 0, 1.2, 2)
		if w.t > (9 if w.naval else 40):
			wrecks.remove_at(wi)
	_fog_t -= dt
	if _fog_t <= 0:
		_fog_t = 0.2
		update_fog()
	_check_t -= dt
	if _check_t <= 0:
		_check_t = 1
		for pl in players:
			var alive := false
			for e in _blds:
				if e.owner == pl.id and not e.dead:
					alive = true
					break
			pl.alive = alive
		if not players[0].alive:
			over = -1
		elif not players[1].alive:
			over = 1
		# a slow trickle so a broke player is never stuck for good
		for pl in players:
			if pl.alive and pl.credits < _trickle_below:
				var harv := false
				for e in ents:
					if e.owner == pl.id and not e.is_b and e.u.get("harvester", false):
						harv = true
						break
				if not harv:
					pl.credits += _trickle
	_in_update = false


## a dead one lets go of the others, so no ring of references keeps it in memory
static func _forget(e: Ent) -> void:
	e.target = null
	e.last_attacker = null
	e.board_on = null
	e.carried_by = null
	e.capture_b = null
	e.enter_g = null
	e.inside = null
	e.strike = null
	e.passengers.clear()


## Lets go of everything, for a battle that is thrown away (RefCounted objects that point at each
## other would otherwise stay in memory). The game cannot be used afterwards.
func dispose() -> void:
	for e in ents:
		_forget(e)
	for g in garrisons:
		g.occ.clear()
		g.b = null
	for s in shots:
		s.target = null
	ents.clear()
	_list = []
	_blds.clear()
	by_id.clear()
	g_at.clear()
	garrisons.clear()
	shots.clear()
	fx.clear()
	_fx_pool.clear()
	_pq.clear()
	_jh_b = null
	on_sound = Callable()


func _update_building(b: Ent, dt: float) -> void:
	if b.built < 1:
		b.built = minf(1, b.built + dt / _rise_seconds)
		if b.built >= 1:
			update_power()
			if b.key == "ref":
				var ex := Vector2(b.tx + b.w + 0.5, b.ty + b.h - 0.5)
				var w := pf.nearest_walkable(ex.x, ex.y)
				var u := add_unit(b.owner, "harv", w.x + 0.5 if w.x >= 0 else ex.x, w.y + 0.5 if w.x >= 0 else ex.y)
				u.order = "harvest"
				u.hs = "toOre"
			msg("%s fertig" % b.b.name, "good", b.owner)
		return
	# repairs cost a little money
	if b.repairing:
		var pl := players[b.owner]
		var rate := b.max_hp / _repair_seconds
		var heal := minf(rate * dt, b.max_hp - b.hp)
		var cost := (heal / b.max_hp) * float(b.b.cost) * _repair_share
		if heal <= 0:
			b.repairing = false
		elif pl.credits >= cost:
			pl.credits -= cost
			b.hp += heal
			if rand.next() < dt * 3:
				add_fx("spark", b.x + (rand.next() - 0.5) * b.w, b.y + (rand.next() - 0.5) * b.h, 10 + rand.next() * 10, 0, 0, 8, 0.4, 1)
	# damaged buildings smoke and burn
	var k := b.hp / b.max_hp
	if k < 0.5:
		b.smoke_t -= dt
		if b.smoke_t <= 0:
			b.smoke_t = 0.25 if k < 0.25 else 0.6
			var ox := (rand.next() - 0.5) * b.w * 0.8
			var oy := (rand.next() - 0.5) * b.h * 0.8
			add_fx("smoke", b.x + ox, b.y + oy, 12, 0, 0, 12, 3, 3 + rand.next() * 2)
			if k < 0.25:
				add_fx("fire", b.x + ox, b.y + oy, 8, 0, 0, 0, 0.7, 1)
	if b.has_wp:
		var pl := players[b.owner]
		var low := pl.power_use > pl.power_prod
		var rg := range_of(b)
		if b.target != null and (b.target.dead or dist(b, b.target) > rg + 0.5 or not visible_to(b.owner, b.target)):
			b.target = null
		b.scan_t -= dt
		if b.target == null and b.scan_t <= 0:
			b.scan_t = 0.4
			b.target = find_target(b, rg)
		_aim_and_fire(b, dt * (_low_power_def if low else 1.0))


func _update_unit(u: Ent, dt: float) -> void:
	var def := u.u
	# aboard a ship: just ride along
	if u.carried_by != null:
		u.x = u.carried_by.x
		u.y = u.carried_by.y
		return
	if u.is_jet:
		_update_jet(u, dt)
		return
	u.anim += dt
	var has_w := u.has_wp
	# experience: the best heal themselves
	if u.rank >= 3 and u.hp < u.max_hp:
		u.hp = minf(u.max_hp, u.hp + u.max_hp * _vet_regen * dt)
	# keeping still (for snipers)
	if u.moving or time - u.fired_t < 0.5:
		u.still_t = 0.0
	else:
		u.still_t += dt
	# holding a house: shoot from the windows at whatever comes in reach
	if u.inside != null:
		var g := u.inside
		u.x = g.x
		u.y = g.y
		u.moving = false
		if not has_w:
			return
		var rg := range_of(u)
		if u.target != null and (u.target.dead or dist(u, u.target) > rg or (u.order != "attack" and not visible_to(u.owner, u.target))):
			u.target = null
			u.order = "idle"
		u.scan_t -= dt
		if u.target == null and u.scan_t <= 0:
			u.scan_t = 0.35 + rand.next() * 0.15
			u.target = find_target(u, rg)
		_aim_and_fire(u, dt)
		return
	var order := u.order
	if order == "enter" or order == "capture":
		var g := u.enter_g
		var b := u.capture_b
		var gone := false
		if order == "enter":
			gone = g == null or (g.b != null and g.b.dead)
		else:
			gone = b == null or b.dead or b.owner == u.owner
		if gone:
			u.order = "idle"
			u.enter_g = null
			u.capture_b = null
			u.guard = Vector2(u.x, u.y)
		elif g != null and (g_dist(u, g) < 0.75 or (u.path.is_empty() and u.dest == null and g_dist(u, g) < 1.6)):
			_enter(u, g)
			return
		elif b != null and (dist(u, b) < 0.75 or (u.path.is_empty() and u.dest == null and dist(u, b) < 1.6)):
			_capture(u, b)
			return
		else:
			u.repath_t -= dt
			if u.path.is_empty() and u.dest == null and u.repath_t <= 0:
				u.repath_t = 1.5
				if g != null:
					_walk_to(u, g.tx, g.ty, g.w, g.h)
				else:
					_walk_to(u, b.tx, b.ty, b.w, b.h)
		_move(u, dt)
		return
	if def.get("carrier", 0):
		_carrier_deck(u, dt)
	if order == "board":
		var ship := u.board_on
		if ship == null or ship.dead:
			u.order = "idle"
			u.board_on = null
		elif Rng.hypot(ship.x - u.x, ship.y - u.y) < ship.radius + 1.7:
			_board(u, ship)
			return
		else:
			u.repath_t -= dt
			if u.repath_t <= 0 or (u.path.is_empty() and u.dest == null and u.repath_t < 1):
				u.repath_t = 2.0
				var sp: Variant = shore_point(ship.x, ship.y, 6)
				if sp != null:
					set_dest(u, sp.land.x, sp.land.y)
		_move(u, dt)
		return
	# targets
	var t := u.target
	if t != null and (t.dead or (t.owner != u.owner and u.order != "attack" and not visible_to(u.owner, t))):
		u.target = null
		if u.order == "attack":
			u.order = "amove" if u.amove != null else "idle"
			if u.amove != null:
				set_dest(u, u.amove.x, u.amove.y)
			else:
				u.guard = Vector2(u.x, u.y)
	if has_w:
		u.scan_t -= dt
		if u.scan_t <= 0:
			u.scan_t = 0.35 + rand.next() * 0.15
			order = u.order
			if order == "idle" or order == "amove":
				if u.target == null:
					var nt := find_target(u, maxf(range_of(u), u.sight - 1) if order == "idle" else u.sight)
					if nt != null:
						u.target = nt
				# the guard post: an idle unit does not chase too far
				if order == "idle" and u.target != null:
					if u.guard == null:
						u.guard = Vector2(u.x, u.y)
					var gp: Vector2 = u.guard
					if Rng.hypot(u.target.x - gp.x, u.target.y - gp.y) > u.w_range + 5:
						u.target = null
						if Rng.hypot(u.x - gp.x, u.y - gp.y) > 1:
							set_dest(u, gp.x, gp.y)
			elif order == "move" and (u.turret or u.is_air):
				# shoot while driving at whatever comes in range
				u.target = find_target(u, u.w_range)
			elif order == "harvest":
				u.target = null
	# chase or stop to shoot
	t = u.target
	if t != null and has_w and u.order != "move":
		var d := dist(u, t)
		if d > u.w_range:
			u.repath_t -= dt
			# (a ground unit waits a tick when this tick's path finding is used up)
			if (u.repath_t <= 0 or (u.path.is_empty() and not u.is_air)) and (u.is_air or _path_room()):
				u.repath_t = 1.2
				if u.is_air:
					u.dest = Vector2(t.x, t.y)
				else:
					set_dest(u, t.x, t.y)
		elif u.w_min > 0 and d < u.w_min and not u.is_air:
			# too close for artillery: back off
			u.repath_t -= dt
			if u.repath_t <= 0 and _path_room():
				u.repath_t = 1.5
				var a := atan2(u.y - t.y, u.x - t.x)
				set_dest(u, u.x + cos(a) * 3, u.y + sin(a) * 3)
		else:
			u.path = PackedInt32Array()
			u.dest = null
	if def.get("harvester", false):
		_harvest(u, dt)
	_move(u, dt)
	if has_w:
		_aim_and_fire(u, dt)
	if u.order == "unload" and u.dest == null and u.path.is_empty():
		if not _unload_here(u, u.unload_at):
			msg("Kein Ufer in Reichweite zum Entladen", "warn", u.owner)
		u.order = "idle"
		u.unload_at = null
	# wakes behind boats, dust behind vehicles off the road
	if u.moving and u.speed_now > 0.4:
		u.wake_t -= dt
		if u.wake_t <= 0:
			var rad := u.urad
			var c := cos(u.dir)
			var s := sin(u.dir)
			if u.is_naval:
				u.wake_t = 0.07
				var back := rad * 0.9
				var bx := u.x - c * back
				var by := u.y - s * back
				var side := (rand.next() - 0.5) * rad * 0.8
				add_fx("wake", bx - s * side, by + c * side, 0, -c * 0.3, -s * 0.3, 0, 1.4 + rad, 3 if rad > 0.7 else 2)
				add_fx("wake", u.x + c * rad * 0.8, u.y + s * rad * 0.8, 0, -s * 0.5, c * 0.5, 0, 0.6, 1)
			elif not u.is_air and not u.infantry:
				u.wake_t = 0.18
				var tt := map.ter[map.idx(floori(u.x), floori(u.y))]
				if tt != GameMap.ROAD and tt != GameMap.BRIDGE and tt != GameMap.GRASS:
					add_fx("dust", u.x - c * 0.5, u.y - s * 0.5, 1, 0, 0, 3, 0.9, 1)
				# exhaust from the engine deck
				if rand.next() < 0.6:
					add_fx("smoke", u.x - c * rad * 0.8, u.y - s * rad * 0.8, 6, -c * 0.2, -s * 0.2, 6, 0.8, 0)
	# arriving ends a move order
	if u.dest == null and u.path.is_empty():
		if u.order == "move" or (u.order == "amove" and u.target == null):
			u.order = "idle"
			u.amove = null
			u.guard = Vector2(u.x, u.y)
	# helicopters climb after take-off and stay up
	if u.is_air:
		var want := 30.0
		u.z += signf(want - u.z) * minf(absf(want - u.z), dt * 14)


func mounts_turret(u: Ent) -> bool:
	return u.turret


# ─────────────────────────────────────────────────────── jets and carriers

## where a jet comes down: its slot on the airfield, or the carrier's deck (into _jh_*)
func _jet_home(u: Ent) -> bool:
	var h: Ent = by_id.get(u.home)
	if h != null and not h.dead:
		if h.is_b:
			var p := slot_pos(h, u.slot)
			_jh_x = p.x
			_jh_y = p.y
		else:
			_jh_x = h.x
			_jh_y = h.y
		_jh_b = h
		return true
	# home is gone: any free slot or carrier with room
	var spot := free_slot(u.owner, u)
	if not spot.is_empty():
		u.home = spot[0].id
		u.slot = spot[1]
		var p := slot_pos(spot[0], spot[1])
		_jh_x = p.x
		_jh_y = p.y
		_jh_b = spot[0]
		return true
	for c in ents:
		if c.dead or c.owner != u.owner or c.is_b or not c.u.get("carrier", 0):
			continue
		var out := 0
		for j in ents:
			if j.is_jet and not j.dead and j.home == c.id:
				out += 1
		if c.planes + out < int(c.u.carrier):
			u.home = c.id
			u.slot = -1
			_jh_x = c.x
			_jh_y = c.y
			_jh_b = c
			return true
	return false


func _fly(u: Ent, tx: float, ty: float, dt: float, speed: float, alt: float) -> void:
	var want := atan2(ty - u.y, tx - u.x)
	u.dir = turn_to(u.dir, want, float(u.u.turn) * dt)
	u.tdir = u.dir
	u.jspeed += signf(speed - u.jspeed) * minf(absf(speed - u.jspeed), dt * 4)
	u.x += cos(u.dir) * u.jspeed * dt
	u.y += sin(u.dir) * u.jspeed * dt
	var N := map.N
	u.x = maxf(-4, minf(N + 4, u.x))
	u.y = maxf(-4, minf(N + 4, u.y))
	u.z += signf(alt - u.z) * minf(absf(alt - u.z), dt * 22)
	u.moving = true


func _update_jet(u: Ent, dt: float) -> void:
	var def := u.u
	u.anim += dt
	match u.js:
		"park":
			u.moving = false
			u.jspeed = 0.0
			u.z = 0.0
			var h: Ent = by_id.get(u.home)
			if h == null or h.dead:
				# the airfield is gone: fly to another one if there is one
				if _jet_home(u):
					u.js = "back"
				else:
					kill(u, -1)
				return
			if u.ammo < 1:
				var pl := players[u.owner]
				var low := pl.power_use > pl.power_prod
				u.rearm += dt * (0.5 if low else 1.0)
				if u.rearm >= _rearm_seconds:
					u.ammo = 1
					u.rearm = 0.0
					if u.owner == 0:
						msg("%s wieder einsatzbereit" % def.name, "good")
		"out":
			var s := u.strike
			if s == null or (s.e != null and s.e.dead):
				u.js = "back"
				return
			var tx := s.e.x if s.e != null else s.x
			var ty := s.e.y if s.e != null else s.y
			_fly(u, tx, ty, dt, float(def.speed), 34)
			# the volley
			if u.burst > 0:
				u.burst_t -= dt
				if u.burst_t <= 0:
					u.burst_t = float(u.wp.get("gap", 0.2))
					u.burst -= 1
					fire_at(u, s.e, tx, ty)
					if u.burst == 0:
						u.ammo = 0
						u.js = "back"
						u.strike = null
						u.order = "idle"
				return
			var d := Rng.hypot(tx - u.x, ty - u.y)
			var off := absf(ang_diff(u.dir, atan2(ty - u.y, tx - u.x)))
			if u.ammo >= 1 and d < u.w_range and d > 1.5 and off < 0.3 and u.z > 20:
				u.burst = u.w_burst
				u.burst_t = 0.0
		"back":
			if not _jet_home(u):
				# nowhere to land: it circles until the fuel runs out
				u.rearm += dt
				_fly(u, u.x + cos(u.dir + 0.5), u.y + sin(u.dir + 0.5), dt, float(def.speed) * 0.8, 34)
				if u.rearm > 25:
					kill(u, -1)
				return
			_fly(u, _jh_x, _jh_y, dt, float(def.speed), 30)
			if Rng.hypot(_jh_x - u.x, _jh_y - u.y) < 3:
				u.js = "land"
		"land":
			if not _jet_home(u):
				u.js = "back"
				return
			var hx := _jh_x
			var hy := _jh_y
			var hb := _jh_b
			var d := Rng.hypot(hx - u.x, hy - u.y)
			var want := atan2(hy - u.y, hx - u.x)
			u.jspeed = maxf(0.6, minf(float(def.speed) * 0.5, d * 2))
			if d > 0.1:
				u.dir = turn_to(u.dir, want, float(def.turn) * 2 * dt)
			var step := minf(d, u.jspeed * dt)
			u.x += cos(want) * step
			u.y += sin(want) * step
			var deck := 0.0 if hb.is_b else 6.0
			u.z = maxf(deck, minf(u.z, deck + d * 9))
			if d < 0.12:
				if not hb.is_b:
					# stowed below deck
					hb.planes += 1
					u.dead = true
					u.selected = false
					by_id.erase(u.id)
					return
				u.js = "park"
				u.z = 0.0
				u.dir = PI / 2
				u.tdir = u.dir
				u.moving = false


## a carrier rebuilds lost jets and sends them at anything in reach
func _carrier_deck(u: Ent, dt: float) -> void:
	var cap := int(u.u.carrier)
	var out := 0
	for j in ents:
		if j.is_jet and not j.dead and j.home == u.id:
			out += 1
	if u.planes + out < cap:
		u.plane_t += dt
		if u.plane_t > _carrier_rebuild:
			u.plane_t = 0.0
			u.planes += 1
	u.launch_t -= dt
	if u.planes <= 0 or u.launch_t > 0:
		return
	u.launch_t = 1.0
	# the nearest enemy on land or water it can see
	var best: Ent = null
	var bd := _carrier_range
	for e in ents:
		if e.dead or e.owner == u.owner or e.is_air or e.carried_by != null:
			continue
		var d := Rng.hypot(e.x - u.x, e.y - u.y)
		if d < bd and visible_to(u.owner, e):
			bd = d
			best = e
	if best == null:
		return
	var j := add_unit(u.owner, "jet", u.x, u.y)
	j.home = u.id
	j.slot = -1
	j.z = 6.0
	j.dir = u.dir
	j.tdir = u.dir
	j.jspeed = 3.0
	j.js = "out"
	j.order = "strike"
	j.strike = Ent.Strike.new(best, best.x, best.y)
	u.planes -= 1
	u.launch_t = 3.0
	on_sound.call("jet", u.x, u.y)


func _harvest(u: Ent, dt: float) -> void:
	if u.order != "harvest":
		return
	var m := map
	var N := m.N
	match u.hs:
		"toOre":
			if u.cargo >= harvest_load:
				u.hs = "toRef"
				return
			if u.ore_tile < 0 or m.ore[u.ore_tile] <= 0:
				u.ore_tile = find_ore(u.x, u.y, u)
				if u.ore_tile < 0:
					u.hs = "toRef" if u.cargo > 0 else "idle"
					if u.hs == "idle":
						msg("Kein Erz mehr erreichbar", "warn", u.owner)
					return
				u.path = PackedInt32Array()
				u.dest = null
			@warning_ignore("integer_division")
			var oy := (u.ore_tile / N) + 0.5
			var ox := (u.ore_tile % N) + 0.5
			if Rng.hypot(u.x - ox, u.y - oy) < 0.55:
				u.hs = "mining"
				u.mine_t = 0.0
				u.path = PackedInt32Array()
				u.dest = null
			elif u.dest == null and u.path.is_empty():
				set_dest(u, ox, oy)
				var d: Variant = u.dest
				if d == null:
					u.ore_tile = -1
				elif Rng.hypot(d.x - ox, d.y - oy) > 1.5:
					# cannot reach this one: forget it for now
					u.ore_tile = -1
		"mining":
			u.mine_t += dt
			if rand.next() < dt * 4:
				add_fx("dust", u.x + (rand.next() - 0.5) * 0.4, u.y + (rand.next() - 0.5) * 0.4, 2, 0, 0, 4, 0.8, 2)
			if u.mine_t >= _mine_interval:
				u.mine_t = 0.0
				var ot := u.ore_tile
				var take := minf(minf(_mine_amount, m.ore[ot]), harvest_load - u.cargo)
				m.ore[ot] = int(m.ore[ot] - take)
				u.cargo += take
				if m.ore[ot] <= 0:
					m.ore[ot] = 0
					m.ter[ot] = GameMap.DIRT
					ore_changed.append(ot)
				if u.cargo >= harvest_load:
					u.hs = "toRef"
				elif m.ore[ot] <= 0:
					u.hs = "toOre"
		"toRef":
			var ref := nearest_refinery(u)
			if ref == null:
				u.hs = "idle"
				return
			var dock := dock_of(ref)
			if Rng.hypot(u.x - dock.x, u.y - dock.y) < 0.7:
				u.hs = "unload"
				u.mine_t = 0.0
				u.path = PackedInt32Array()
				u.dest = null
			elif u.dest == null and u.path.is_empty():
				set_dest(u, dock.x, dock.y)
		"unload":
			u.mine_t += dt
			var rate := harvest_load / _unload_seconds
			var give := minf(u.cargo, rate * dt)
			var pl := players[u.owner]
			var mult := float(_ai_income[opts.difficulty]) if pl.ai else 1.0
			u.cargo -= give
			pl.credits += give * mult
			pl.stats.harvested += give * mult
			if u.cargo <= 0.01:
				u.cargo = 0.0
				u.hs = "toOre"
		"idle":
			if rand.next() < dt * 0.2:
				u.hs = "toRef" if u.cargo > 0 else "toOre"


func dock_of(ref: Ent) -> Vector2:
	var w := pf.nearest_walkable(ref.tx + ref.w + 0.5, ref.ty + ref.h - 0.5, 4)
	return Vector2(w.x + 0.5, w.y + 0.5) if w.x >= 0 else Vector2(ref.tx + ref.w + 0.5, ref.ty + ref.h - 0.5)


func nearest_refinery(u: Ent) -> Ent:
	var best: Ent = null
	var bd := 1e9
	for e in _blds:
		if e.dead or e.owner != u.owner or e.key != "ref" or e.built < 1:
			continue
		var d := Rng.hypot(e.x - u.x, e.y - u.y)
		if d < bd:
			bd = d
			best = e
	return best


## the nearest ore that few other trucks are heading for
func find_ore(x: float, y: float, self_: Ent) -> int:
	var m := map
	var ore := m.ore
	var best := -1
	var bd := 1e9
	var taken := {}
	for e in ents:
		if e != self_ and not e.is_b and e.ore_tile >= 0 and e.u.get("harvester", false):
			taken[e.ore_tile] = taken.get(e.ore_tile, 0) + 1
	var cx := floori(x)
	var cy := floori(y)
	for r in 40:
		if best >= 0 and r > bd + 2:
			break
		for dy in range(-r, r + 1):
			for dx in range(-r, r + 1):
				if maxi(absi(dx), absi(dy)) != r:
					continue
				var tx := cx + dx
				var ty := cy + dy
				if not m.in_map(tx, ty):
					continue
				var i := m.idx(tx, ty)
				if ore[i] <= 0 or not m.walk_i(i):
					continue
				var d := Rng.hypot(dx, dy) + int(taken.get(i, 0)) * 3
				if d < bd:
					bd = d
					best = i
	return best


# ─────────────────────────────────────────────────────── moving

func _move(u: Ent, dt: float) -> void:
	var m := map
	var N := m.N
	var def := u.u
	var tx: float
	var ty: float
	if u.is_air:
		if u.dest == null:
			u.moving = false
			u.speed_now = 0.0
			# hover in place, turning slowly to face a target
			if u.target != null:
				u.dir = turn_to(u.dir, atan2(u.target.y - u.y, u.target.x - u.x), float(def.turn) * dt)
			return
		var dv: Vector2 = u.dest
		tx = dv.x
		ty = dv.y
		var d := Rng.hypot(tx - u.x, ty - u.y)
		if d < 0.15:
			u.dest = null
			u.moving = false
			return
		var want := atan2(ty - u.y, tx - u.x)
		u.dir = turn_to(u.dir, want, float(def.turn) * dt)
		var sp := float(def.speed) * (0.4 if u.z < 20 else 1.0)
		var step := minf(d, sp * dt)
		var a := 1.0 if absf(ang_diff(u.dir, want)) < 1.2 else 0.3
		u.x += cos(want) * step * a
		u.y += sin(want) * step * a
		u.x = maxf(0.5, minf(N - 0.5, u.x))
		u.y = maxf(0.5, minf(N - 0.5, u.y))
		u.moving = true
		return
	var plen := u.path.size()
	if u.pi < plen:
		var i := u.path[u.pi]
		var last := u.pi == plen - 1
		if last and u.dest != null:
			var dv: Vector2 = u.dest
			tx = dv.x
			ty = dv.y
		else:
			tx = (i % N) + 0.5
			@warning_ignore("integer_division")
			ty = (i / N) + 0.5
		var d := Rng.hypot(tx - u.x, ty - u.y)
		if d < (0.08 if last else 0.3):
			u.pi += 1
			if u.pi >= plen:
				u.path = PackedInt32Array()
				u.dest = null
				u.moving = false
				u.speed_now = 0.0
			return
		var want := atan2(ty - u.y, tx - u.x)
		var k := 1.0
		var turn := float(def.turn)
		if turn > 0:
			u.dir = turn_to(u.dir, want, turn * dt)
			var off := absf(ang_diff(u.dir, want))
			k = 1.0 if off < 0.35 else (0.45 if off < 1.2 else 0.05)
		else:
			u.dir = want
		var t := m.ter[clampi(floori(u.y), 0, N - 1) * N + clampi(floori(u.x), 0, N - 1)]
		var terrain := 1.0
		if not u.is_naval:
			terrain = 1.25 if t == GameMap.ROAD or t == GameMap.BRIDGE else (0.92 if t == GameMap.FIELD else (0.85 if t == GameMap.SAND else 1.0))
		var target := float(def.speed) * terrain * k
		u.speed_now += (target - u.speed_now) * minf(1, dt * (10.0 if u.infantry else 3.0))
		var step := minf(d, u.speed_now * dt)
		var hd := u.dir if turn > 0 else want
		_try_move(u, cos(hd) * step, sin(hd) * step)
		u.moving = true
		# stuck?
		u.stuck_t += dt
		if u.stuck_t > 1.6:
			var moved := Rng.hypot(u.x - u.stuck_x, u.y - u.stuck_y)
			u.stuck_t = 0.0
			u.stuck_x = u.x
			u.stuck_y = u.y
			if moved < 0.25:
				u.repaths += 1
				var goal: Vector2
				if u.dest != null:
					goal = u.dest
				else:
					var lp := u.path[u.path.size() - 1]
					@warning_ignore("integer_division")
					goal = Vector2((lp % N) + 0.5, (lp / N) + 0.5)
				if u.repaths > 3 or Rng.hypot(goal.x - u.x, goal.y - u.y) < 1.6:
					u.path = PackedInt32Array()
					u.dest = null
					u.moving = false
				else:
					var keep := u.repaths
					set_dest(u, goal.x, goal.y)
					u.repaths = keep
	else:
		u.moving = false
		u.speed_now = 0.0


func _try_move(u: Ent, dx: float, dy: float) -> void:
	var m := map
	var r := minf(0.3, u.urad) * 0.7
	var nx := u.x + dx
	var ny := u.y + dy
	var nav := u.is_naval
	if _ok_at(m, nav, nx, ny, r):
		u.x = nx
		u.y = ny
	elif _ok_at(m, nav, nx, u.y, r):
		u.x = nx
	elif _ok_at(m, nav, u.x, ny, r):
		u.y = ny
	elif not (m.nav(floori(u.x), floori(u.y)) if nav else m.walk(floori(u.x), floori(u.y))):
		# inside something (a building went up on top): get out
		var w := (npf if nav else pf).nearest_walkable(u.x, u.y)
		if w.x >= 0:
			u.x = w.x + 0.5
			u.y = w.y + 0.5


static func _ok_at(m: GameMap, nav: bool, x: float, y: float, r: float) -> bool:
	var x0 := floori(x - r)
	var y0 := floori(y - r)
	var x1 := floori(x + r)
	var y1 := floori(y + r)
	if nav:
		return m.nav(x0, y0) and m.nav(x1, y1) and m.nav(x0, y1) and m.nav(x1, y0)
	return m.walk(x0, y0) and m.walk(x1, y1) and m.walk(x0, y1) and m.walk(x1, y0)


func _build_spatial() -> void:
	var n := ents.size()
	if _next.size() < n:
		_next.resize(n * 2)
	_head.fill(-1)
	_list = ents
	var N := map.N
	for i in n:
		var e := ents[i]
		if e.is_b or e.dead or e.is_air or e.carried_by != null or e.inside != null:
			_next[i] = -2
			continue
		var t := clampi(floori(e.y), 0, N - 1) * N + clampi(floori(e.x), 0, N - 1)
		_next[i] = _head[t]
		_head[t] = i


## units push each other apart, the moving ones yield less than the waiting ones
func _separate(dt: float) -> void:
	var N := map.N
	var list := _list
	var head := _head
	var nxt := _next
	var kdt := minf(1, dt * 12)
	for i in list.size():
		var a := list[i]
		if a.is_b or a.dead or a.is_air or a.carried_by != null or a.inside != null:
			continue
		if a.is_naval:
			_separate_ship(a, i, dt)
			continue
		var cx := floori(a.x)
		var cy := floori(a.y)
		for ty in range(cy - 1, cy + 2):
			if ty < 0 or ty >= N:
				continue
			for tx in range(cx - 1, cx + 2):
				if tx < 0 or tx >= N:
					continue
				var j := head[ty * N + tx]
				while j >= 0:
					if j > i:
						var b := list[j]
						if not b.dead and not b.is_naval and b.inside == null:
							var dx := b.x - a.x
							var dy := b.y - a.y
							var d := sqrt(dx * dx + dy * dy)
							var mn := (a.urad + b.urad) * (0.9 if a.infantry and b.infantry else 1.0)
							if d < 1e-4:
								b.x += 0.01
							elif d < mn:
								var push := minf(0.5, (mn - d) * 0.5) * kdt
								var ux := dx / d
								var uy := dy / d
								var wa := 0.3 if a.moving and not b.moving else (0.7 if not a.moving and b.moving else 0.5)
								_try_move(a, -ux * push * 2 * wa, -uy * push * 2 * wa)
								_try_move(b, ux * push * 2 * (1 - wa), uy * push * 2 * (1 - wa))
					j = nxt[j]


static func _hull_len(u: Ent) -> float:
	var hull: Array = u.u.get("hull", [])
	return float(hull[0]) if hull.size() > 0 else u.urad


## ships are long: they keep apart as capsules, and the smaller one gives way
func _separate_ship(a: Ent, i: int, dt: float) -> void:
	var N := map.N
	var list := _list
	var ha := _hull_len(a)
	var hwa := _hull_w(a)
	# a's keel
	var ka := maxf(0, ha - hwa)
	var ca := cos(a.dir)
	var sa := sin(a.dir)
	var ax0 := a.x - ca * ka
	var ay0 := a.y - sa * ka
	var ax1 := a.x + ca * ka
	var ay1 := a.y + sa * ka
	var reach := ceili(ha + 2.8)
	var cx := floori(a.x)
	var cy := floori(a.y)
	for ty in range(cy - reach, cy + reach + 1):
		if ty < 0 or ty >= N:
			continue
		for tx in range(cx - reach, cx + reach + 1):
			if tx < 0 or tx >= N:
				continue
			var j := _head[ty * N + tx]
			while j >= 0:
				var b := list[j]
				var jj := j
				j = _next[j]
				if jj == i or b.dead or not b.is_naval:
					continue
				# each pair once: from the bigger hull, or the lower index between equals
				var hb := _hull_len(b)
				if hb > ha or (hb == ha and jj < i):
					continue
				var hwb := _hull_w(b)
				var kb := maxf(0, hb - hwb)
				var cb := cos(b.dir)
				var sb := sin(b.dir)
				_seg_closest(ax0, ay0, ax1, ay1, b.x - cb * kb, b.y - sb * kb, b.x + cb * kb, b.y + sb * kb)
				var mn := hwa + hwb + 0.12
				if _sc_d >= mn:
					continue
				var ux: float
				var uy: float
				if _sc_d < 1e-4:
					# right on top of each other: push sideways from a's keel
					ux = -sin(a.dir)
					uy = cos(a.dir)
				else:
					ux = (_sc_bx - _sc_ax) / _sc_d
					uy = (_sc_by - _sc_ay) / _sc_d
				var ov := (mn - _sc_d) * minf(1, dt * 10)
				# the bigger ship and the one standing still give way less
				var ma := _hull_area(a) * (1.0 if a.moving else 1.6)
				var mb := _hull_area(b) * (1.0 if b.moving else 1.6)
				var wa := mb / (ma + mb)
				_try_move(a, -ux * ov * wa, -uy * ov * wa)
				_try_move(b, ux * ov * (1 - wa), uy * ov * (1 - wa))
				# the one behind slows down instead of ramming
				if a.moving and cos(a.dir) * (b.x - a.x) + sin(a.dir) * (b.y - a.y) > 0:
					a.speed_now *= 1 - minf(0.5, dt * 4)
				if b.moving and cos(b.dir) * (a.x - b.x) + sin(b.dir) * (a.y - b.y) > 0:
					b.speed_now *= 1 - minf(0.5, dt * 4)


static func _hull_w(u: Ent) -> float:
	var hull: Array = u.u.get("hull", [])
	return float(hull[1]) if hull.size() > 1 else u.urad


static func _hull_area(u: Ent) -> float:
	var hull: Array = u.u.get("hull", [])
	return (float(hull[0]) if hull.size() > 0 else 1.0) * (float(hull[1]) if hull.size() > 1 else 1.0)


# ─────────────────────────────────────────────────────── fighting

## distance from an attacker to the nearest part of a target
func dist(a: Ent, t: Ent) -> float:
	if t.is_b:
		var dx := maxf(maxf(t.tx - a.x, 0.0), a.x - (t.tx + t.w))
		var dy := maxf(maxf(t.ty - a.y, 0.0), a.y - (t.ty + t.h))
		return sqrt(dx * dx + dy * dy)
	var ex := t.x - a.x
	var ey := t.y - a.y
	return maxf(0.0, sqrt(ex * ex + ey * ey) - t.urad * 0.5)


## a snapshot of where each side's eyes are, for the computer's sight during a tick
func _snap_sight() -> void:
	for p in 2:
		var ox := PackedFloat64Array()
		var oy := PackedFloat64Array()
		var os := PackedFloat64Array()
		var of := PackedInt32Array()
		for e in ents:
			if e.owner != p or e.dead or e.carried_by != null:
				continue
			ox.append(e.x)
			oy.append(e.y)
			os.append(e.sight)
			of.append((1 if e.is_b else 0) | (2 if e.inside != null else 0))
		_ox[p] = ox
		_oy[p] = oy
		_os[p] = os
		_of[p] = of


func visible_to(p: int, e: Ent) -> bool:
	if e.owner == p:
		return true
	if e.carried_by != null:
		return false
	if _in_update:
		# once per tick and side (the answer cannot change much within one tick)
		if p == 0:
			if e.vk0 == _tick:
				return e.vv0
			e.vk0 = _tick
			e.vv0 = _visible(p, e, true)
			return e.vv0
		if e.vk1 == _tick:
			return e.vv1
		e.vk1 = _tick
		e.vv1 = _visible(p, e, true)
		return e.vv1
	return _visible(p, e, false)


func _visible(p: int, e: Ent, snap: bool) -> bool:
	# inside a house only the flag shows, until the muzzle flashes give them away
	if e.inside != null and time - e.fired_t > 2.5:
		var near := false
		var g := e.inside
		if snap:
			var ox := _ox[p]
			var oy := _oy[p]
			var of := _of[p]
			for k in ox.size():
				if of[k] != 0:
					continue
				var dx := maxf(maxf(g.tx - ox[k], 0.0), ox[k] - (g.tx + g.w))
				var dy := maxf(maxf(g.ty - oy[k], 0.0), oy[k] - (g.ty + g.h))
				if dx * dx + dy * dy < 1.44:
					near = true
					break
		else:
			for o in ents:
				if o.owner != p or o.dead or o.is_b or o.carried_by != null or o.inside != null:
					continue
				if g_dist(o, g) < 1.2:
					near = true
					break
		if not near:
			return false
	# a sniper keeping still is only seen from close by
	if e.hidden:
		var near := false
		var r2 := _spotted_within * _spotted_within
		if snap:
			var ox := _ox[p]
			var oy := _oy[p]
			var of := _of[p]
			for k in ox.size():
				if of[k] & 1:
					continue
				var dx := ox[k] - e.x
				var dy := oy[k] - e.y
				if dx * dx + dy * dy < r2:
					near = true
					break
		else:
			for o in ents:
				if o.owner != p or o.dead or o.is_b or o.carried_by != null:
					continue
				if Rng.hypot(o.x - e.x, o.y - e.y) < _spotted_within:
					near = true
					break
		if not near:
			return false
	if p == 0:
		var N := map.N
		if e.is_b:
			for y in range(e.ty, e.ty + e.h):
				for x in range(e.tx, e.tx + e.w):
					if fog[y * N + x] == 2:
						return true
			return false
		var tx := floori(e.x)
		var ty := floori(e.y)
		if tx < 0 or ty < 0 or tx >= N or ty >= N:
			return false
		return fog[ty * N + tx] == 2
	# the computer sees what its units and buildings see
	var extra := e.radius if e.is_b else 0.0
	if snap:
		var ox := _ox[p]
		var oy := _oy[p]
		var os := _os[p]
		var ex := e.x
		var ey := e.y
		for k in ox.size():
			var dx := ox[k] - ex
			var dy := oy[k] - ey
			var r := os[k] + extra
			if dx * dx + dy * dy <= r * r:
				return true
		return false
	for o in ents:
		if o.owner != p or o.dead or o.carried_by != null:
			continue
		if Rng.hypot(o.x - e.x, o.y - e.y) <= o.sight + extra:
			return true
	return false


func find_target(u: Ent, range_: float) -> Ent:
	if not u.has_wp:
		return null
	var best: Ent = null
	var bs := 1e9
	var own := u.owner
	var wmin := u.w_min
	var vrow := u.w_cls_i * ARMORS.size()
	var wa := u.w_air
	var ws := u.w_sea
	var wg := u.w_ground
	var ux := u.x
	var uy := u.y
	for e in ents:
		if e.dead or e.owner == own or e.carried_by != null:
			continue
		if not (wa if e.is_air else (ws if e.is_naval else wg)):
			continue
		var d: float
		if e.is_b:
			var dx := maxf(maxf(e.tx - ux, 0.0), ux - (e.tx + e.w))
			var dy := maxf(maxf(e.ty - uy, 0.0), uy - (e.ty + e.h))
			d = sqrt(dx * dx + dy * dy)
		else:
			var ex := e.x - ux
			var ey := e.y - uy
			var reach := range_ + e.urad * 0.5
			var d2 := ex * ex + ey * ey
			if d2 > reach * reach:
				continue
			d = maxf(0.0, sqrt(d2) - e.urad * 0.5)
		if d > range_:
			continue
		if wmin > 0 and d < wmin:
			continue
		if not visible_to(own, e):
			continue
		# prefer what this weapon is good against, and what shoots back
		var s := d - _vs[vrow + e.armor_i] * 3 - (1.5 if e.has_wp else 0.0) + (2.0 if e.is_b else 0.0)
		if s < bs:
			bs = s
			best = e
	return best


func _aim_and_fire(u: Ent, dt: float) -> void:
	u.cd -= dt
	var t := u.target
	if u.burst > 0:
		u.burst_t -= dt
		if u.burst_t <= 0 and t != null and not t.dead:
			u.burst -= 1
			u.burst_t = u.w_gap
			fire_at(u, t, t.x, t.y)
		elif t == null or t.dead:
			u.burst = 0
		return
	if t == null:
		# turrets drift back to the front
		if not u.is_b and u.turret:
			u.tdir = turn_to(u.tdir, u.dir, dt * (1.5 if not u.moving else 2.5))
		return
	var d := dist(u, t)
	var want := atan2(t.y - u.y, t.x - u.x)
	var aligned: bool
	# missiles leave their cells straight up, so a ship need not turn for them
	var vertical: bool = u.wp.proj == "missile"
	if u.is_b or u.turret:
		u.tdir = turn_to(u.tdir, want, dt * (1.4 if u.key == "art" else 3.2))
		aligned = vertical or absf(ang_diff(u.tdir, want)) < 0.12
	elif u.infantry:
		if not u.moving:
			u.dir = want
		aligned = not u.moving
		u.tdir = u.dir
	elif u.is_naval:
		aligned = true
		u.tdir = u.dir
	else:
		# no turret: the whole thing turns (helicopters)
		if not u.moving or u.is_air:
			var trn := float(u.u.turn)
			u.dir = turn_to(u.dir, want, dt * (trn if trn != 0 else 4.0))
		aligned = absf(ang_diff(u.dir, want)) < 0.2
		u.tdir = u.dir
	if d > range_of(u) or (u.w_min > 0 and d < u.w_min):
		return
	if not aligned or u.cd > 0:
		return
	if not u.is_b and u.infantry and u.moving:
		return
	u.cd = float(u.wp.reload) * (0.92 + rand.next() * 0.16)
	u.burst = u.w_burst - 1
	u.burst_t = u.w_gap
	fire_at(u, t, t.x, t.y)


## one shot from a unit at a target, or at a point on the ground
func fire_at(u: Ent, t: Ent, tx: float, ty: float) -> void:
	var w := u.wp
	var proj: String = w.proj
	var yaw := u.tdir if u.is_b or u.turret else u.dir
	var mz: float
	if u.is_b:
		mz = 7.0 if u.key == "bunker" else 4.0
	elif u.inside != null:
		mz = 16.0 if u.inside.kind == "church" else 9.0
	elif u.is_air:
		mz = u.z
	else:
		mz = 5.0 if u.infantry else (9.0 if u.is_naval else 7.0)
	var along: float
	if u.is_b:
		along = 0.3
	elif u.inside != null:
		along = 0.45
	elif u.infantry:
		along = 0.25
	elif u.is_jet:
		along = 0.2
	else:
		along = u.urad * 0.8 + 0.15
	var side := 0.0
	if u.w_burst > 1 and not u.infantry:
		side = 0.2 if u.burst % 2 else -0.2
	var cy := cos(yaw)
	var sy := sin(yaw)
	var x0 := u.x + cy * along - sy * side
	var y0 := u.y + sy * along + cy * side
	var x1 := t.x if t != null else tx
	var y1 := t.y if t != null else ty
	var z1 := 0.0
	if t != null:
		z1 = t.z if t.is_air else (8.0 if t.is_b else (5.0 if t.is_naval else 3.0))
	# artillery and missiles at a point are not exact
	if proj == "art" or proj == "mlrs" or (t == null and proj == "missile"):
		var spread := 1.2 if proj == "mlrs" else 0.5
		x1 += (rand.next() - 0.5) * spread * 2
		y1 += (rand.next() - 0.5) * spread * 2
	elif t != null and t.is_b:
		x1 += (rand.next() - 0.5) * t.w * 0.6
		y1 += (rand.next() - 0.5) * t.h * 0.6
	var dd := Rng.hypot(x1 - x0, y1 - y0)
	var T := maxf(0.05, dd / float(SPEED[proj]) + (0.6 if proj == "art" else 0.0))
	var lob := proj == "missile" and not u.is_air
	var s := Shot.new()
	s.kind = proj
	s.owner = u.owner
	s.x0 = x0
	s.y0 = y0
	s.z0 = mz
	s.x1 = x1
	s.y1 = y1
	s.z1 = z1
	s.target = null if proj == "art" or proj == "mlrs" else t
	s.T = T
	if proj == "art":
		s.arc = dd * 9 + 20
	elif proj == "mlrs":
		s.arc = dd * 6 + 16
	elif lob:
		s.arc = dd * 4 + 30
	elif proj == "rocket":
		s.arc = 4
	s.dmg = float(w.dmg) * (1 + _dmg_bonus * u.rank)
	s.cls = w.cls
	s.cls_i = u.w_cls_i
	s.splash = float(w.get("splash", 0.0))
	s.src = u.id
	shots.append(s)
	u.fired_t = time
	# muzzle flash
	var heavy := proj == "art" or proj == "shell" or proj == "missile"
	add_fx("flash", x0, y0, mz, 0, 0, 0, 0.18 if proj == "art" else 0.08, 3.0 if heavy else (1.0 if proj == "snipe" else 1.5))
	if heavy:
		add_fx("smoke", x0, y0, mz, 0, 0, 6, 1.4, 4 if proj == "art" or proj == "missile" else 2)
	on_sound.call(proj, u.x, u.y)
	if not u.is_b and not u.infantry and not u.is_jet:
		u.speed_now *= 0.85


func _update_shots(dt: float) -> void:
	var i := shots.size() - 1
	while i >= 0:
		var s := shots[i]
		s.t += dt
		var t := s.target
		if t != null and not t.dead:
			s.x1 = t.x
			s.y1 = t.y
			if t.is_air:
				s.z1 = t.z
		if s.kind == "rocket" or s.kind == "mlrs" or s.kind == "missile":
			s.trail_t -= dt
			if s.trail_t <= 0:
				s.trail_t = 0.03 if s.kind == "missile" else 0.04
				var p := shot_pos(s)
				add_fx("smoke", p.x, p.y, p.z, 0, 0, 3, 1.1 if s.kind == "missile" else 0.7, 1)
		if s.t >= s.T:
			shots.remove_at(i)
			_impact(s)
		i -= 1


func shot_pos(s: Shot) -> Vector3:
	var p := minf(1, s.t / s.T)
	return Vector3(s.x0 + (s.x1 - s.x0) * p, s.y0 + (s.y1 - s.y0) * p, s.z0 + (s.z1 - s.z0) * p + s.arc * 4 * p * (1 - p))


func _wet(x: float, y: float) -> bool:
	var tx := floori(x)
	var ty := floori(y)
	return map.nav(tx, ty) and map.ter[map.idx(tx, ty)] == GameMap.WATER


func _impact(s: Shot) -> void:
	var big := s.kind == "art" or s.kind == "mlrs" or s.kind == "missile"
	var water := _wet(s.x1, s.y1)
	if s.splash > 0:
		for e in ents:
			if e.dead or e.is_air or e.carried_by != null:
				continue
			var d := dist_pt(e, s.x1, s.y1) if e.is_b else Rng.hypot(e.x - s.x1, e.y - s.y1)
			if d > s.splash:
				continue
			_damage_i(e, s.dmg * (1 - (d / s.splash) * _splash_falloff), s.cls_i, s.owner, s.src)
		var ship_hit := false
		for e in ents:
			if e.is_naval and not e.dead and Rng.hypot(e.x - s.x1, e.y - s.y1) < e.urad + 0.3:
				ship_hit = true
				break
		var power := 2.4 if s.kind == "art" else (2.2 if s.kind == "missile" else (1.6 if s.kind == "mlrs" else (1.5 if big else 0.9)))
		if water and not ship_hit:
			boom(s.x1, s.y1, 0, power, "water")
		else:
			boom(s.x1, s.y1, 2, power, "deck" if water else "ground")
		on_sound.call("boom", s.x1, s.y1)
		return
	var t := s.target
	if t != null and not t.dead:
		_damage_i(t, s.dmg, s.cls_i, s.owner, s.src)
		if s.kind == "shell" or s.kind == "rocket":
			boom(s.x1, s.y1, s.z1, 0.8 if s.kind == "rocket" else 0.65, "air")
			on_sound.call("hit", s.x1, s.y1)
		else:
			add_fx("spark", s.x1, s.y1, s.z1, 0, 0, 6, 0.25, 1)
	elif water:
		add_fx("splash", s.x1, s.y1, 0, 0, 0, 0, 0.6, 0)
	elif s.kind == "shell" or s.kind == "rocket":
		boom(s.x1, s.y1, 1, 0.6, "ground")
	else:
		add_fx("dust", s.x1, s.y1, 1, 0, 0, 3, 0.4, 2)


## An explosion with weight behind it: a fireball and smaller blasts after it, a pressure ring
## across the ground, earth thrown up, embers, a column of smoke, a crater, and a shaken camera.
## `power`: 0.6 a shell hitting armour … 2.4 a heavy howitzer round … 4 a building going up.
## `where`: ground | water | air | deck
func boom(x: float, y: float, z: float, power: float, where: String) -> void:
	var r := rand
	var size := 3 if power >= 2.2 else (2 if power >= 1.4 else (1 if power >= 0.9 else 0))
	if where == "water":
		add_fx("splash", x, y, 0, 0, 0, 0, 1 + power * 0.25, minf(3, Rng.js_round(power)))
		add_fx("ring", x, y, 0, 0, 0, 0, 0.5 + power * 0.15, power)
		var k := 0
		while k < power * 6:
			var a := r.next() * PI * 2
			var v := (0.5 + r.next()) * power * 0.9
			add_fx("wake", x + cos(a) * 0.3, y + sin(a) * 0.3, 0, cos(a) * v, sin(a) * v, 0, 1.2, 2)
			k += 1
		if power >= 1.5:
			add_fx("exp", x, y, 2, 0, 0, 0, 0.45, maxi(0, size - 1))
		return
	# the fireball, then a few smaller blasts around it
	add_fx("exp", x, y, z, 0, 0, 0, 0.55 + size * 0.22, size)
	if power > 2.6:
		fx[-1].scale = minf(2, power / 2.4)
	add_fx("flash", x, y, z + 2, 0, 0, 0, 0.12 + size * 0.04, 2 + power * 2)
	var extra := int(Rng.js_round(power * 1.3)) if power >= 1 else 0
	for k in extra:
		var a := r.next() * PI * 2
		var d := (0.25 + r.next() * 0.45) * minf(1.6, power * 0.5)
		add_fx("exp", x + cos(a) * d, y + sin(a) * d, z + r.next() * 6, 0, 0, 0, 0.45 + size * 0.1, maxi(0, size - 1))
		fx[-1].t = -0.05 - r.next() * 0.25
	if where == "air":
		var k := 0
		while k < 3 + power * 4:
			var a := r.next() * PI * 2
			var v := 0.8 + r.next() * 1.5
			add_fx("ember", x, y, z, cos(a) * v, sin(a) * v, 10 + r.next() * 25, 0.5 + r.next() * 0.4, 1)
			k += 1
		add_fx("smoke", x, y, z, 0, 0, 8, 1.6, 2 + size)
		return
	# the pressure ring rolls out over the ground
	if power >= 0.9:
		add_fx("ring", x, y, 0, 0, 0, 0, 0.35 + power * 0.1, power)
	# earth and stones thrown up
	if where == "ground":
		# a fountain of earth: most of it goes up steeply, some flies wide
		var n := int(Rng.js_round(power * 16))
		for k in n:
			var a := r.next() * PI * 2
			var steep := r.next() < 0.6
			var v := (0.2 + r.next() * 0.5 if steep else 0.6 + r.next() * 1.2) * (0.7 + power * 0.5)
			var up := 55 + r.next() * 45 * power if steep else 25 + r.next() * 25 * power
			add_fx("clod", x + (r.next() - 0.5) * 0.2, y + (r.next() - 0.5) * 0.2, 2, cos(a) * v, sin(a) * v, up, 1.6 + r.next() * 1.4, 3 if r.next() < 0.4 else 2)
		# a curtain of dust round the base
		for k in int(Rng.js_round(power * 3)):
			var a := r.next() * PI * 2
			var v := 0.6 + r.next() * 0.8 * power
			add_fx("dust", x, y, 1, cos(a) * v, sin(a) * v, 3 + r.next() * 4, 1.8 + power * 0.6, 3 + power)
	# glowing embers
	for k in int(Rng.js_round(power * 6)):
		var a := r.next() * PI * 2
		var v := (0.5 + r.next()) * (0.8 + power * 0.5)
		add_fx("ember", x, y, z + 3, cos(a) * v, sin(a) * v, 20 + r.next() * 35 * power, 0.6 + r.next() * 0.8, 1)
	# a column of smoke that stays a while
	for k in int(Rng.js_round(2 + power * 2.5)):
		add_fx("smoke", x + (r.next() - 0.5) * 0.5, y + (r.next() - 0.5) * 0.5, z + 2 + k * 4, (r.next() - 0.5) * 0.15, (r.next() - 0.5) * 0.15, 4 + r.next() * 6, 3 + power * 1.6, 4 + minf(4, power * 1.6))
		fx[-1].t = -0.25 - k * 0.15
	if where == "ground" and power >= 1.4:
		_stamp("scorch", 2 if power >= 3 else 1, x, y)
	elif where == "ground" and power >= 0.9:
		_stamp("scorch", 0, x, y)


func _stamp(kind: String, size: int, x: float, y: float) -> void:
	var s := Stamp.new()
	s.kind = kind
	s.size = size
	s.x = x
	s.y = y
	stamps.append(s)


func dist_pt(b: Ent, x: float, y: float) -> float:
	var dx := maxf(maxf(b.tx - x, 0.0), x - (b.tx + b.w))
	var dy := maxf(maxf(b.ty - y, 0.0), y - (b.ty + b.h))
	return Rng.hypot(dx, dy)


## `cls`: the weapon class (mg, cannon, …)
func damage(e: Ent, dmg: float, cls: String, from: int, src: int = 0) -> void:
	_damage_i(e, dmg, WCLASSES.find(cls), from, src)


func _damage_i(e: Ent, dmg: float, cls_i: int, from: int, src: int) -> void:
	if e.dead or e.owner == from or e.carried_by != null:
		return
	var d := dmg * _vs[cls_i * ARMORS.size() + e.armor_i] * (_dmg_lo + rand.next() * _dmg_span) * (1 - _armor_bonus * e.rank) * (cover if e.inside != null else 1.0)
	e.hp -= d
	e.last_hit = time
	e.flash_t = time
	# under fire: those near it come to help
	if e.owner == 0 and time - alert_t > 20:
		alert_t = time
		msg("Unsere Basis wird angegriffen!" if e.is_b else "Unsere Einheiten werden angegriffen!", "warn")
		on_sound.call("alert", e.x, e.y)
	var shooter: Ent = by_id.get(src)
	var attacker: Ent = shooter if shooter != null and not shooter.dead else _nearest_enemy_shooter(e, from)
	if attacker != null:
		e.last_attacker = attacker
	if not e.is_b and e.order == "idle" and e.target == null and attacker != null and e.has_wp and can_hit(e, attacker) and (e.inside == null or dist(e, attacker) <= range_of(e)):
		e.target = attacker
	if e.hp <= 0:
		kill(e, from, src)


func _nearest_enemy_shooter(e: Ent, from: int) -> Ent:
	var best: Ent = null
	var bd := 1e9
	for o in ents:
		if o.dead or o.owner != from or not o.has_wp or o.target != e:
			continue
		var d := Rng.hypot(o.x - e.x, o.y - e.y)
		if d < bd:
			bd = d
			best = o
	return best


func kill(e: Ent, by: int, src: int = 0) -> void:
	if e.dead:
		return
	players[e.owner].stats.lost += 1
	if by >= 0:
		players[by].stats.killed += 1
	# the shooter earns its stripes
	var killer: Ent = by_id.get(src)
	if killer != null and not killer.dead and not killer.is_b:
		killer.kills += 1
		var rank := 0
		for k in ranks:
			if killer.kills >= int(k):
				rank += 1
		if rank > killer.rank:
			killer.rank = rank
			killer.hp = minf(killer.max_hp, killer.hp + killer.max_hp * _promote_heal)
			if killer.owner == 0:
				msg("%s befördert: %s" % [killer.u.name, rank_names[rank]], "good")
			on_sound.call("promote", killer.x, killer.y)
	if e.is_b:
		remove_building(e, true)
		return
	e.dead = true
	e.selected = false
	by_id.erase(e.id)
	if e.inside != null:
		var g := e.inside
		g.occ.erase(e)
		if g.occ.is_empty() and g.b == null:
			g.owner = -1
			if e.owner == 0:
				msg("%s verloren" % g.name, "warn")
		e.inside = null
	# whoever was aboard goes down with the ship
	for p in e.passengers:
		p.dead = true
		by_id.erase(p.id)
		players[p.owner].stats.lost += 1
	e.passengers = []
	if e.infantry:
		add_fx("dust", e.x, e.y, 2, 0, 0, 2, 0.6, 2)
		on_sound.call("scream", e.x, e.y)
		return
	var z := e.z if e.is_air else (6.0 if e.is_naval else 4.0)
	var water := _wet(e.x, e.y)
	var heavy: bool = e.u.armor == "heavy" or e.urad > 0.7
	var power := ((3.4 if e.urad > 0.7 else 2.2) if e.is_naval else (2.6 if heavy else 1.8))
	boom(e.x, e.y, z, power, "air" if e.is_air else ("deck" if e.is_naval else "ground"))
	for k in (10 if heavy else 6):
		add_fx("debris", e.x, e.y, z + 4, (rand.next() - 0.5) * 4, (rand.next() - 0.5) * 4, 30 + rand.next() * 35, 1.4, 1)
	# a tank's turret goes up in the air
	if e.u.armor == "heavy":
		add_fx("debris", e.x, e.y, z + 8, (rand.next() - 0.5) * 1.5, (rand.next() - 0.5) * 1.5, 70, 1.8, 3)
	if e.is_jet or (e.is_air and water):
		if water:
			add_fx("splash", e.x, e.y, 0, 0, 0, 0, 1, 2)
	else:
		var w := Wreck.new()
		w.key = e.key
		w.owner = e.owner
		w.x = e.x
		w.y = e.y
		w.dir = e.dir
		w.tdir = e.tdir
		w.air = e.is_air
		w.naval = e.is_naval
		wrecks.append(w)
	on_sound.call("explode", e.x, e.y)


func remove_building(e: Ent, destroyed: bool) -> void:
	e.dead = true
	e.selected = false
	by_id.erase(e.id)
	var g := garrison_of(e)
	if g != null:
		for o in g.occ.duplicate():
			_leave(o, g)
			if destroyed:
				o.hp -= o.max_hp * 0.5
				if o.hp <= 0:
					kill(o, enemy_of(o.owner))
		garrisons.erase(g)
		for y in range(g.ty, g.ty + g.h):
			for x in range(g.tx, g.tx + g.w):
				g_at.erase(map.idx(x, y))
	for y in range(e.ty, e.ty + e.h):
		for x in range(e.tx, e.tx + e.w):
			if map.bld[map.idx(x, y)] == e.id:
				map.bld[map.idx(x, y)] = 0
	_map_ver += 1
	if destroyed:
		# a chain of blasts through the building, then the big one
		var n := 2 + e.w * 2
		for k in n:
			var x := e.tx + rand.next() * e.w
			var y := e.ty + rand.next() * e.h
			var first := fx.size()
			boom(x, y, 4 + rand.next() * 10, 1.4 + rand.next() * 0.8, "deck")
			var delay := (float(k) / n) * 1.1
			for i in range(first, fx.size()):
				fx[i].t -= delay
		var before := fx.size()
		boom(e.x, e.y, 6, 4.0 if e.w >= 3 else 3.2, "ground")
		for i in range(before, fx.size()):
			fx[i].t -= 1.2
		for k in 14:
			add_fx("debris", e.x, e.y, 10, (rand.next() - 0.5) * 5, (rand.next() - 0.5) * 5, 30 + rand.next() * 40, 1.6, 1 + (k % 3))
		_stamp("rubble", mini(3, e.w), e.x, e.y)
		msg("%s zerstört" % e.b.name, "warn" if e.owner == 0 else "good")
		on_sound.call("collapse", e.x, e.y)
	update_power()


# ─────────────────────────────────────────────────────── effects and fog

## `kind`: exp | smoke | fire | flash | spark | dust | debris | wake | splash | ring | clod | ember
func add_fx(kind: String, x: float, y: float, z: float, vx: float, vy: float, vz: float, life: float, size: float) -> void:
	if fx.size() > 1800:
		return
	var f: Fx = _fx_pool.pop_back() if _fx_pool.size() > 0 else Fx.new()
	f.kind = kind
	f.ki = FX_KINDS.find(kind)
	f.x = x
	f.y = y
	f.z = z
	f.vx = vx
	f.vy = vy
	f.vz = vz
	f.t = 0.0
	f.life = life
	f.size = size
	f.shook = false
	f.scale = 1.0
	fx.append(f)


func _update_fx(dt: float) -> void:
	var n := fx.size()
	var k := 0
	for i in n:
		var f := fx[i]
		f.t += dt
		if f.t >= 0:
			f.x += f.vx * dt
			f.y += f.vy * dt
			f.z += f.vz * dt
			var ki := f.ki
			if ki == FX_DEBRIS or ki == FX_CLOD or ki == FX_EMBER:
				f.vz -= (25.0 if ki == FX_EMBER else 70.0) * dt
				if f.z < 0:
					f.z = 0.0
					f.vz *= -0.15 if ki == FX_CLOD else -0.3
					f.vx *= 0.2 if ki == FX_CLOD else 0.5
					f.vy *= 0.2 if ki == FX_CLOD else 0.5
			elif ki == FX_SMOKE:
				f.vx += 0.12 * dt # a light wind
			if f.t >= f.life:
				_fx_pool.append(f)
				continue
		if k != i:
			fx[k] = f
		k += 1
	if k != n:
		fx.resize(k)


func update_fog() -> void:
	var m := map
	var N := m.N
	if reveal:
		fog.fill(2)
		_fog_full = true
		fog_dirty = true
		return
	if _fog_full:
		for i in fog.size():
			if fog[i] == 2:
				fog[i] = 1
		_fog_full = false
	else:
		for i in _lit:
			fog[i] = 1
	_lit.clear()
	for e in ents:
		if e.owner != 0 or e.dead or e.carried_by != null:
			continue
		var r := e.sight + (e.radius if e.is_b else 0.0)
		var cx := e.x
		var cy := e.y
		var r2 := r * r
		var x0 := maxi(0, floori(cx - r))
		var x1 := mini(N - 1, ceili(cx + r))
		for y in range(maxi(0, floori(cy - r)), mini(N - 1, ceili(cy + r)) + 1):
			var dy := y + 0.5 - cy
			var rem := r2 - dy * dy
			if rem < 0:
				continue
			# the row's span, then the ends checked with the exact test
			var s := sqrt(rem)
			var xa := maxi(x0, ceili(cx - 0.5 - s))
			var xb := mini(x1, floori(cx - 0.5 + s))
			while xa > x0 and _in_disc(xa - 1, dy, cx, r2):
				xa -= 1
			while xa <= xb and not _in_disc(xa, dy, cx, r2):
				xa += 1
			while xb < x1 and _in_disc(xb + 1, dy, cx, r2):
				xb += 1
			while xb >= xa and not _in_disc(xb, dy, cx, r2):
				xb -= 1
			var row := y * N
			for x in range(xa, xb + 1):
				if fog[row + x] != 2:
					fog[row + x] = 2
					_lit.append(row + x)
	fog_dirty = true


static func _in_disc(x: int, dy: float, cx: float, r2: float) -> bool:
	var dx := x + 0.5 - cx
	return dx * dx + dy * dy <= r2


# ─────────────────────────────────────────────────────── helpers

static func ang_diff(a: float, b: float) -> float:
	var d := fmod(b - a, PI * 2)
	if d > PI:
		d -= PI * 2
	if d < -PI:
		d += PI * 2
	return d


static func turn_to(a: float, b: float, step: float) -> float:
	var d := ang_diff(a, b)
	if absf(d) <= step:
		return b
	return a + signf(d) * step


## indices of `keys` in ascending order; equal keys keep their order (as JS's stable sort)
static func sort_order(keys: PackedFloat64Array) -> PackedInt32Array:
	var idx: Array[int] = []
	idx.resize(keys.size())
	for i in keys.size():
		idx[i] = i
	idx.sort_custom(func(a: int, b: int) -> bool: return keys[a] < keys[b] or (keys[a] == keys[b] and a < b))
	return PackedInt32Array(idx)


## the closest points between two segments, and how far apart they are (into _sc_*)
func _seg_closest(ax0: float, ay0: float, ax1: float, ay1: float, bx0: float, by0: float, bx1: float, by1: float) -> void:
	var dx1 := ax1 - ax0
	var dy1 := ay1 - ay0
	var dx2 := bx1 - bx0
	var dy2 := by1 - by0
	var rx := ax0 - bx0
	var ry := ay0 - by0
	var aa := dx1 * dx1 + dy1 * dy1
	var ee := dx2 * dx2 + dy2 * dy2
	var ff := dx2 * rx + dy2 * ry
	var s := 0.0
	var t := 0.0
	if aa < 1e-9 and ee < 1e-9:
		s = 0.0
		t = 0.0
	elif aa < 1e-9:
		t = clampf(ff / ee, 0, 1)
	else:
		var c := dx1 * rx + dy1 * ry
		if ee < 1e-9:
			s = clampf(-c / aa, 0, 1)
		else:
			var bb := dx1 * dx2 + dy1 * dy2
			var den := aa * ee - bb * bb
			s = clampf((bb * ff - c * ee) / den, 0, 1) if den > 1e-9 else 0.0
			t = (bb * s + ff) / ee
			if t < 0:
				t = 0.0
				s = clampf(-c / aa, 0, 1)
			elif t > 1:
				t = 1.0
				s = clampf((bb - c) / aa, 0, 1)
	_sc_ax = ax0 + dx1 * s
	_sc_ay = ay0 + dy1 * s
	_sc_bx = bx0 + dx2 * t
	_sc_by = by0 + dy2 * t
	_sc_d = Rng.hypot(_sc_bx - _sc_ax, _sc_by - _sc_ay)
