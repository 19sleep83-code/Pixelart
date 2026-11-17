class_name Ent
extends RefCounted
## A unit or a building on the battlefield. Port of `Ent` in src/game/game.ts.
##
## Optional values are null when absent (points as Vector2, references as Ent / Game.Garrison).
## `u` is the unit's def Dictionary from Data (empty for a building), `b` the building's (empty for
## a unit). Fields after "cached from the def" are read-only helpers for the simulation.

## a jet's ground strike: at a unit or building (`e`), or at a point
class Strike:
	var e: Ent = null
	var x := 0.0
	var y := 0.0

	func _init(e_: Ent, x_: float, y_: float) -> void:
		e = e_
		x = x_
		y = y_


static var next_id := 1
## a sniper keeping still this long is hidden (rules.json `sniperHideAfter`)
static var hide_after := 2.5

const QUARTER := PI * 0.75

var id: int
var owner: int
var key: String
var is_b: bool
var u: Dictionary
var b: Dictionary
var hp: float
var max_hp: float
var x := 0.0
var y := 0.0
var z := 0.0
var dir := QUARTER
var tdir := QUARTER
var dead := false
# moving
var path := PackedInt32Array()
var pi := 0
## Vector2 or null
var dest: Variant = null
## idle | move | attack | amove | harvest | board | unload | strike | enter | capture
var order := "idle"
var target: Ent = null
## Vector2 or null
var amove: Variant = null
## Vector2 or null
var guard: Variant = null
var moving := false
var speed_now := 0.0
var stuck_t := 0.0
var stuck_x := 0.0
var stuck_y := 0.0
var repaths := 0
var repath_t := 0.0
var scan_t := randf() * 0.3
var anim := randf() * 10.0
# weapons
var cd := randf() * 0.5
var burst := 0
var burst_t := 0.0
# harvester
var cargo := 0.0
## idle | toOre | mining | toRef | unload
var hs := "idle"
var ore_tile := -1
var mine_t := 0.0
# building
var tx := 0
var ty := 0
var w := 1
var h := 1
var built := 1.0
## Vector2 or null
var rally: Variant = null
var repairing := false
# bookkeeping
var last_hit := -99.0
var last_attacker: Ent = null
var selected := false
var smoke_t := 0.0
# carrying and being carried
var passengers: Array[Ent] = []
var carried_by: Ent = null
var board_on: Ent = null
## Vector2 or null
var unload_at: Variant = null
# jets
var home := 0
var slot := -1
## park | out | back | land
var js := "park"
var ammo := 1
var rearm := 0.0
## Ent.Strike or null
var strike: Strike = null
var jspeed := 0.0
# a carrier's own jets
var planes := 0
var plane_t := 0.0
var launch_t := 0.0
# holding a house
var inside: Game.Garrison = null
var enter_g: Game.Garrison = null
var capture_b: Ent = null
# experience, stealth and looks
var kills := 0
var rank := 0
var still_t := 0.0
var fired_t := -99.0
var flash_t := -99.0
var wake_t := 0.0
# what each side saw of it this tick (Game.visible_to)
var vk0 := 0
var vv0 := false
var vk1 := 0
var vv1 := false

# cached from the def (never change after creation)
## the weapon Dictionary, empty if none
var wp: Dictionary = {}
var has_wp := false
var is_air := false
var is_naval := false
var is_jet := false
var infantry := false
## the unit's radius (0 for buildings)
var urad := 0.0
var base_sight := 0.0
## index of the armour class in Game.ARMORS ("bld" for buildings)
var armor_i := 0
## a turret that turns on its own (Game.mounts_turret)
var turret := false
var w_range := 0.0
var w_min := 0.0
var w_gap := 0.1
var w_burst := 1
var w_cls_i := 0
var w_ground := false
var w_air := false
var w_sea := false

var weapon: Variant:
	get:
		if has_wp:
			return wp
		return null

var radius: float:
	get:
		return maxf(w, h) / 2.0 if is_b else urad

var air: bool:
	get:
		return is_air

var naval: bool:
	get:
		return is_naval

var jet: bool:
	get:
		return is_jet

## a sniper keeping still
var hidden: bool:
	get:
		return not is_b and u.get("stealth", false) and still_t > hide_after

var sight: float:
	get:
		return base_sight + (inside.sight if inside != null else 0.0)


func _init(owner_: int, key_: String, def: Dictionary, is_b_: bool) -> void:
	id = next_id
	next_id += 1
	owner = owner_
	key = key_
	is_b = is_b_
	if is_b:
		b = def
	else:
		u = def
	hp = float(def["hp"])
	max_hp = hp
	base_sight = float(def["sight"])
	var wv: Variant = def.get("weapon")
	if wv is Dictionary:
		wp = wv
		has_wp = true
		w_range = float(wp["range"])
		w_min = float(wp.get("minRange", 0.0))
		w_gap = float(wp.get("gap", 0.1))
		w_burst = int(wp.get("burst", 1))
		w_cls_i = Game.WCLASSES.find(String(wp["cls"]))
		w_ground = bool(wp.get("ground", false))
		w_air = bool(wp.get("air", false))
		# a weapon reaches ships as it reaches the land, unless it says otherwise
		w_sea = bool(wp.get("sea", w_ground))
	if is_b:
		armor_i = Game.ARMORS.find("bld")
	else:
		is_air = bool(u.get("air", false))
		is_naval = bool(u.get("naval", false))
		is_jet = bool(u.get("jet", false))
		infantry = bool(u.get("infantry", false))
		urad = float(u["radius"])
		armor_i = Game.ARMORS.find(String(u["armor"]))
		turret = not infantry and not u.get("harvester", false) and not is_air and not u.get("transport", 0) and not u.get("carrier", 0)


## can this weapon hit that kind of target (`reaches` in the prototype)
func reaches(t: Ent) -> bool:
	return w_air if t.is_air else (w_sea if t.is_naval else w_ground)
