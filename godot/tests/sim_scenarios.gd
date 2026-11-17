extends Node
## The browser prototype's scenario checks, on the ported simulation:
##   godot --headless --path godot res://tests/runner.tscn -- sim_scenarios
## Houses (enter, cover, range bonus, hidden until firing, exit), a bunker with crew destroyed,
## an engineer capturing a power plant, a landing ship carrying troops to another shore, a jet
## strike with return and rearming, and a carrier launching its jets. Prints PASS/FAIL lines.

const DT := 1.0 / 30.0

var _fails := 0
var _passes := 0


func run(_args: PackedStringArray) -> void:
	_houses()
	_bunker()
	_capture()
	_landing()
	_jets()
	_carrier()
	print("%d PASS, %d FAIL" % [_passes, _fails])
	print("ALL PASS" if _fails == 0 else "SOME FAILED")


func _check(ok: bool, what: String, detail: String = "") -> void:
	if ok:
		_passes += 1
	else:
		_fails += 1
	print("%s  %s%s" % ["PASS" if ok else "FAIL", what, ("  (" + detail + ")") if detail != "" else ""])


func _step(g: Game, secs: float, until: Callable = Callable()) -> float:
	var t := 0.0
	while t < secs:
		g.update(DT)
		t += DT
		if until.is_valid() and until.call():
			break
	return t


func _hq(g: Game, p: int) -> Ent:
	for e in g.ents:
		if e.owner == p and e.key == "hq":
			return e
	return null


## a building of `key` placed (and finished) near a point, searching outward
func _place(g: Game, owner: int, key: String, cx: int, cy: int, r0: int = 2, r1: int = 14) -> Ent:
	for r in range(r0, r1):
		for dy in range(-r, r + 1):
			for dx in range(-r, r + 1):
				if maxi(absi(dx), absi(dy)) != r:
					continue
				if g.can_place(0, key, cx + dx, cy + dy):
					var b := g.add_building(owner, key, cx + dx, cy + dy)
					b.built = 1.0
					g.update_power()
					return b
	return null


func _clear_units(g: Game, p: int) -> void:
	for e in g.ents:
		if e.owner == p and not e.is_b and e.inside == null:
			e.dead = true
			g.by_id.erase(e.id)


func _houses() -> void:
	print("-- house")
	var g := Game.new({"seed": 777, "faction": "nato", "difficulty": 1, "mapType": "land"})
	g.reveal = true
	g.update_fog()
	var hq := _hq(g, 0)
	var houses: Array[Game.Garrison] = []
	var keys := PackedFloat64Array()
	for h in g.garrisons:
		if h.b == null:
			houses.append(h)
			keys.append(Rng.hypot(h.x - hq.x, h.y - hq.y))
	_check(houses.size() > 0, "village houses can be held", "%d garrisons" % houses.size())
	if houses.is_empty():
		return
	var h := houses[Game.sort_order(keys)[0]]
	var rifles: Array[Ent] = []
	for e in g.ents:
		if e.owner == 0 and e.key == "rifle":
			rifles.append(e)
	for k in rifles.size():
		var w := g.pf.nearest_walkable(h.x + 3, h.y + 2 + k * 0.4)
		rifles[k].x = w.x + 0.5
		rifles[k].y = w.y + 0.5
	g.command_garrison(rifles, h)
	_step(g, 25)
	var all_in := true
	for u in rifles:
		all_in = all_in and u.inside == h and u.order == "idle"
	_check(h.occ.size() == 3 and h.owner == 0 and all_in, "three riflemen enter the %s" % h.kind, "occ %d owner %d" % [h.occ.size(), h.owner])
	var u0 := h.occ[0] if h.occ.size() > 0 else rifles[0]
	_check(is_equal_approx(g.range_of(u0), u0.w_range + h.range), "range bonus from the windows", "%.2f = %.2f + %.2f" % [g.range_of(u0), u0.w_range, h.range])
	_check(is_equal_approx(u0.sight, u0.base_sight + h.sight), "sight bonus from the windows", "%.1f" % u0.sight)
	# hidden from the enemy until they fire
	var hidden := true
	for u in h.occ:
		hidden = hidden and not g.visible_to(1, u)
	_check(hidden, "soldiers inside are hidden from the enemy")
	# the enemy walks up
	var foes: Array[Ent] = []
	for k in 6:
		var w := g.pf.nearest_walkable(h.x + 9 + k * 0.3, h.y + 1)
		foes.append(g.add_unit(1, "rifle", w.x + 0.5, w.y + 0.5))
	g.command_move(foes, h.x + 1, h.y + 1.5, true)
	var first_shot := -1.0
	var seen_after_shot := false
	var t := 0.0
	var foe_shot_back := false
	while t < 25:
		g.update(DT)
		t += DT
		for u in h.occ:
			if first_shot < 0 and g.time - u.fired_t < 0.05:
				first_shot = t
				seen_after_shot = g.visible_to(1, u)
		for f in foes:
			if not f.dead and f.target != null and f.target.inside == h:
				foe_shot_back = true
	_check(first_shot >= 0, "the house opens fire", "after %.1f s" % first_shot)
	_check(seen_after_shot, "firing gives them away")
	_check(foe_shot_back, "the enemy shoots back at the house")
	var foes_alive := 0
	for f in foes:
		if not f.dead:
			foes_alive += 1
	var hp: Array[String] = []
	for u in h.occ:
		hp.append("%d" % roundi(u.hp))
	_check(foes_alive < 6 and h.occ.size() >= 2, "the house holds against six riflemen", "foes left %d, inside %d hp %s" % [foes_alive, h.occ.size(), ",".join(hp)])
	# cover: only 30% of the damage reaches them
	if h.occ.size() > 0:
		var u := h.occ[0]
		u.hp = 1000.0
		u.max_hp = 1000.0
		g.damage(u, 100.0, "mg", 1)
		var lost := 1000.0 - u.hp
		_check(lost >= 100 * 0.9 * g.cover - 0.01 and lost <= 100 * 1.1 * g.cover + 0.01, "cover: %.0f%% of the damage gets through" % (g.cover * 100), "lost %.1f of 100" % lost)
		u.hp = 55.0
		u.max_hp = 55.0
	# everyone out
	var inside: Array[Ent] = h.occ.duplicate()
	g.command_exit(inside)
	var out_ok := h.occ.is_empty() and h.owner == -1
	for u in inside:
		out_ok = out_ok and u.inside == null and g.map.walk(floori(u.x), floori(u.y)) and u.guard != null
	_check(out_ok and inside.size() > 0, "they leave the house onto open ground", "occ %d owner %d" % [h.occ.size(), h.owner])


func _bunker() -> void:
	print("-- bunker")
	var g := Game.new({"seed": 777, "faction": "nato", "difficulty": 1, "mapType": "land"})
	g.reveal = true
	var hq := _hq(g, 0)
	var bk := _place(g, 0, "bunker", hq.tx, hq.ty)
	_check(bk != null, "a bunker is built")
	if bk == null:
		return
	var crew: Array[Ent] = []
	for k in 4:
		var w := g.pf.nearest_walkable(bk.x + 2, bk.y + 2)
		crew.append(g.add_unit(0, "at", w.x + 0.5, w.y + 0.5))
	var bg := g.garrison_of(bk)
	_check(bg != null and bg.cap == 3, "the bunker takes three soldiers")
	var r0 := g.range_of(bk)
	g.command_garrison(crew, bg)
	_step(g, 10)
	_check(bg.occ.size() == 3, "three of four get in", "inside %d" % bg.occ.size())
	_check(is_equal_approx(g.range_of(bk), r0 + 0.5), "a manned bunker reaches further", "%.1f -> %.1f" % [r0, g.range_of(bk)])
	var inside: Array[Ent] = bg.occ.duplicate()
	g.kill(bk, 1)
	var ok := not g.garrisons.has(bg) and bk.dead
	var hp: Array[String] = []
	for u in inside:
		ok = ok and not u.dead and u.inside == null and is_equal_approx(u.hp, u.max_hp * 0.5)
		hp.append("%d/%d" % [roundi(u.hp), roundi(u.max_hp)])
	_check(ok, "destroyed: the crew is thrown out at half strength", ",".join(hp))


func _capture() -> void:
	print("-- engineer")
	var g := Game.new({"seed": 777, "faction": "nato", "difficulty": 1, "mapType": "land"})
	var hq := _hq(g, 0)
	var pw := _place(g, 1, "power", hq.tx, hq.ty, 4, 14)
	_check(pw != null, "an enemy power plant stands near our base")
	if pw == null:
		return
	_clear_units(g, 0)
	var prod0 := g.players[0].power_prod
	var eng := g.add_unit(0, "engineer", hq.x + 2, hq.y + 3)
	g.command_capture([eng], pw)
	var t := _step(g, 30, func() -> bool: return pw.owner == 0)
	_check(pw.owner == 0, "the engineer takes the power plant", "after %.1f s" % t)
	_check(eng.dead and not g.by_id.has(eng.id), "the engineer is used up")
	_check(g.players[0].power_prod > prod0, "its power is ours now", "%d -> %d" % [prod0, g.players[0].power_prod])
	var texts: Array[String] = []
	for m in g.msgs:
		texts.append(m.text)
	_check(texts.has("Kraftwerk erobert!"), "message", " | ".join(texts))


func _landing() -> void:
	print("-- landing ship")
	var g := Game.new({"seed": 4242, "faction": "nato", "difficulty": 1, "mapType": "coast"})
	g.reveal = true
	var hq := _hq(g, 0)
	var yard := _place(g, 0, "shipyard", hq.tx, hq.ty, 2, 22)
	_check(yard != null, "a shipyard on the shore", "%d,%d" % [yard.tx, yard.ty] if yard != null else "none")
	if yard == null:
		return
	var w := g.npf.nearest_walkable(yard.x, yard.y, 8)
	var lander := g.add_unit(0, "lander", w.x + 0.5, w.y + 0.5)
	var troops: Array[Ent] = []
	for e in g.ents:
		if e.owner == 0 and not e.is_b and (e.key == "rifle" or e.key == "ifv"):
			troops.append(e)
	g.command_board(troops, lander)
	var t := _step(g, 90, func() -> bool: return lander.passengers.size() == troops.size())
	_check(lander.passengers.size() == troops.size(), "%d units board the landing ship" % troops.size(), "aboard %d after %.1f s" % [lander.passengers.size(), t])
	var carried := true
	for u in troops:
		carried = carried and u.carried_by == lander and Rng.hypot(u.x - lander.x, u.y - lander.y) < 0.01
	_check(carried, "they ride along")
	# another shore: the land beside water far from here, reachable by sea
	var best := Vector2(-1, -1)
	var bd := 0.0
	var N := g.map.N
	for y in N:
		for x in N:
			if not g.map.nav(x, y) or g.map.ter[g.map.idx(x, y)] == GameMap.BRIDGE:
				continue
			for d in Game.DIRS4:
				if not g.map.walk(x + d.x, y + d.y):
					continue
				var dd := Rng.hypot(x - lander.x, y - lander.y)
				if dd > bd and dd < 45:
					var p := g.npf.find(floori(lander.x), floori(lander.y), x, y)
					if p.size() > 0 and p[p.size() - 1] == g.map.idx(x, y):
						bd = dd
						best = Vector2(x + d.x + 0.5, y + d.y + 0.5)
				break
	_check(best.x >= 0, "a far shore", "%.0f tiles away" % bd)
	g.command_move([lander], best.x, best.y, false)
	_check(lander.order == "unload", "sent onto land: it goes to unload")
	t = _step(g, 120, func() -> bool: return lander.passengers.is_empty())
	var ashore := lander.passengers.is_empty()
	var near := 0
	for u in troops:
		if u.carried_by == null and g.map.walk(floori(u.x), floori(u.y)) and Rng.hypot(u.x - best.x, u.y - best.y) < 8:
			near += 1
	_check(ashore and near == troops.size(), "everyone is put ashore on the far side", "%d of %d near the goal after %.1f s" % [near, troops.size(), t])
	_step(g, 8)
	var moved := 0
	for u in troops:
		if Rng.hypot(u.x - best.x, u.y - best.y) < 3:
			moved += 1
	_check(moved >= troops.size() - 1, "and they walk on to the point", "%d at the point" % moved)


func _jets() -> void:
	print("-- jets")
	var g := Game.new({"seed": 11, "faction": "nato", "difficulty": 1, "mapType": "land"})
	g.reveal = true
	var hq := _hq(g, 0)
	var af := _place(g, 0, "airfield", hq.tx, hq.ty, 3, 12)
	_check(af != null, "an airfield")
	if af == null:
		return
	_place(g, 0, "power", hq.tx, hq.ty, 3, 12)
	_place(g, 0, "radar", hq.tx, hq.ty, 3, 12)
	g.players[0].credits = 50000
	_check(g.queue_item(0, "air", "jet"), "a jet is ordered")
	var found: Array[Ent] = []
	_step(g, 40, func() -> bool:
		for e in g.ents:
			if e.is_jet:
				found.append(e)
				return true
		return false)
	var jet: Ent = found[0] if found.size() > 0 else null
	_check(jet != null and jet.js == "park" and jet.home == af.id, "it waits on the airfield", "slot %d" % (jet.slot if jet != null else -1))
	if jet == null:
		return
	var slot := g.slot_pos(af, jet.slot)
	_clear_units(g, 1)
	var foe := _hq(g, 1)
	var hp0 := foe.hp
	g.command_attack([jet], foe)
	_check(jet.js == "out" and jet.order == "strike", "ordered to strike the enemy HQ")
	var fired := 0
	var states := {}
	var t := 0.0
	var landed_at := -1.0
	while t < 90:
		var n0 := g.shots.size()
		g.update(DT)
		t += DT
		states[jet.js] = true
		for k in range(n0, g.shots.size()):
			if g.shots[k].src == jet.id:
				fired += 1
		if jet.js == "park" and states.has("land"):
			landed_at = t
			break
	_check(fired == jet.w_burst, "it fires its volley", "%d missiles" % fired)
	_step(g, 3)
	_check(foe.hp < hp0, "the HQ is hit", "%.0f -> %.0f" % [hp0, foe.hp])
	_check(landed_at > 0 and jet.js == "park" and Rng.hypot(jet.x - slot.x, jet.y - slot.y) < 0.15, "it flies back and lands on its slot", "after %.1f s" % landed_at)
	_check(jet.ammo == 0, "empty after the strike")
	g.command_attack([jet], foe)
	_check(jet.js == "park", "no strike without weapons")
	_step(g, g._rearm_seconds + 0.5)
	_check(jet.ammo == 1, "rearmed after %.0f s" % g._rearm_seconds)


func _carrier() -> void:
	print("-- carrier")
	var g := Game.new({"seed": 4242, "faction": "nato", "difficulty": 1, "mapType": "coast"})
	g.reveal = true
	g.update_fog()
	var hq := _hq(g, 0)
	var w := g.npf.nearest_walkable(hq.x, hq.y, 40)
	_check(w.x >= 0, "open water near the base")
	if w.x < 0:
		return
	var c := g.add_unit(0, "carrier", w.x + 0.5, w.y + 0.5)
	_check(c.planes == 3, "the carrier has three jets aboard")
	# an enemy boat within reach
	var target: Ent = null
	for r in range(6, 16):
		var tw := g.npf.nearest_walkable(c.x + r, c.y, 6)
		if tw.x >= 0 and Rng.hypot(tw.x + 0.5 - c.x, tw.y + 0.5 - c.y) > 5:
			target = g.add_unit(1, "corvette", tw.x + 0.5, tw.y + 0.5)
			break
	if target == null:
		var lw := g.pf.nearest_walkable(c.x + 8, c.y + 8, 10)
		target = g.add_unit(1, "mbt", lw.x + 0.5, lw.y + 0.5)
	_check(target != null, "an enemy %s %.1f tiles away" % [target.key, Rng.hypot(target.x - c.x, target.y - c.y)])
	var hp0 := target.hp
	var launched: Array[Ent] = []
	var t := 0.0
	var back := false
	while t < 80:
		g.update(DT)
		t += DT
		for e in g.ents:
			if e.is_jet and e.home == c.id and not launched.has(e):
				launched.append(e)
		if launched.size() > 0 and c.planes == 3:
			var all_gone := true
			for j in launched:
				all_gone = all_gone and j.dead
			if all_gone:
				back = true
				break
	_check(launched.size() >= 1, "it launches its jets at the enemy", "%d launched" % launched.size())
	_check(target.dead or target.hp < hp0, "the target is hit", "hp %.0f -> %.0f" % [hp0, maxf(0, target.hp)])
	_check(back, "the jets come back and are stowed below deck", "planes %d after %.1f s" % [c.planes, t])
