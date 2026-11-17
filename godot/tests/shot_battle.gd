extends Node
## Pictures of the world in scenes like the prototype's screenshots:
##   xvfb-run -a -s "-screen 0 1600x900x24" godot --path godot --rendering-driver opengl3 \
##     res://tests/runner.tscn -- shot_battle <out dir> [scene …]
## scenes: base_day base_night arty sea air village rain (default: all)

const SCENES := ["base_day", "base_night", "arty", "sea", "air", "village", "rain"]
const STEP := 1.0 / 30.0

var out_dir := "."
var game: Game
var world: World


func run(args: PackedStringArray) -> void:
	out_dir = args[0] if args.size() > 0 else "."
	var which: Array = []
	for i in range(1, args.size()):
		which.append(args[i])
	if which.is_empty():
		which = SCENES
	for s in which:
		var t0 := Time.get_ticks_msec()
		await call("scene_" + s)
		print("%s: %d ms" % [s, Time.get_ticks_msec() - t0])
		_teardown()


func _make(opts: Dictionary) -> void:
	game = Game.new(opts)
	world = World.new()
	add_child(world)
	world.setup(game)
	world.auto_draw = false


func _teardown() -> void:
	if world:
		world.queue_free()
		world = null
	if game:
		game.dispose()
		game = null
	await get_tree().process_frame


func _reveal() -> void:
	game.reveal = true
	game.update_fog()


func _clear_units() -> void:
	for e in game.ents:
		if not e.is_b:
			e.dead = true
			game.by_id.erase(e.id)
	var keep: Array[Ent] = []
	for e in game.ents:
		if not e.dead:
			keep.append(e)
	game.ents = keep


func _hq(owner: int) -> Ent:
	for e in game.ents:
		if e.owner == owner and e.key == "hq":
			return e
	return null


func _step(secs: float) -> void:
	for i in int(round(secs * 30)):
		game.update(STEP)


## draw a few frames (rain needs time to fall), then save
func _shot(name: String, frames := 3, dt := 1.0 / 60.0) -> void:
	for i in frames:
		world.redraw(dt)
		await get_tree().process_frame
	world.redraw(dt)
	await RenderingServer.frame_post_draw
	var path := out_dir.path_join("battle_%s.png" % name)
	get_viewport().get_texture().get_image().save_png(path)
	print("saved ", path, "  draw %.2f ms" % world.draw_ms)


# ─────────────────────────────────────────────────────────────── (a), (b) a base

func _base(tod: String, weather := "clear") -> void:
	_make({"seed": 777, "faction": "nato", "difficulty": 1, "mapType": "coast", "tod": tod, "weather": weather})
	_reveal()
	var hq := _hq(0)
	_clear_units()
	var place := func(key: String, dx: int, dy: int) -> void:
		for r in 8:
			for a in range(-r, r + 1):
				for p in [Vector2i(hq.tx + dx + a, hq.ty + dy - r), Vector2i(hq.tx + dx - r, hq.ty + dy + a)]:
					if game.can_place(0, key, p.x, p.y):
						game.add_building(0, key, p.x, p.y).built = 1
						return
	place.call("power", 4, -1)
	place.call("barracks", -3, 0)
	place.call("factory", 0, 4)
	place.call("radar", 4, 3)
	place.call("bunker", 3, 7)
	place.call("rocket", 5, 7)
	var keys := ["mbt", "ifv", "aa", "art", "scout", "rifle", "rifle", "at"]
	for i in keys.size():
		var w := game.pf.nearest_walkable(hq.x + 2 + i * 1.1, hq.y + 3.5 - i * 0.3)
		var u := game.add_unit(0, keys[i], w.x + 0.5, w.y + 0.5)
		u.dir = 0.3
		u.tdir = 1.2
	game.update(STEP)
	world.set_zoom_level(2)
	world.look_at_tile(hq.x + 3, hq.y + 3)


func scene_base_day() -> void:
	_base("day")
	# one of everything selected, one hovered, a building selected with a rally point
	for e in game.ents:
		if e.key == "mbt" or e.key == "rifle":
			e.selected = true
		if e.key == "factory":
			e.selected = true
			e.rally = Vector2(e.x + 3, e.y + 4)
	await _shot("a_base_day")


func scene_base_night() -> void:
	_base("night")
	await _shot("b_base_night")


# ─────────────────────────────────────────────────────────────── (c) artillery and burning wrecks

func scene_arty() -> void:
	_make({"seed": 4242, "faction": "nato", "difficulty": 1, "mapType": "land", "tod": "day", "weather": "clear"})
	_reveal()
	_clear_units()
	var foe := _hq(1)
	var tw := game.pf.nearest_walkable(foe.x - 2, foe.y + 3.5, 6)
	var aw := game.pf.nearest_walkable(foe.x - 10, foe.y + 8, 8)
	var guns: Array[Ent] = []
	for k in 3:
		var g := game.add_unit(0, "art" if k < 2 else "mlrs", aw.x + 0.5 + k * 1.2, aw.y + 0.5 + k * 0.6)
		g.order = "idle"
		guns.append(g)
	var tanks: Array[Ent] = []
	for k in 5:
		var t := game.add_unit(1, "ifv" if k == 2 else "mbt", tw.x + 0.5 + k * 0.9, tw.y + 0.5 - k * 0.4)
		t.hp = 50000
		t.max_hp = 50000
		t.order = "idle"
		tanks.append(t)
	# two of them burn already
	_step(0.2)
	game.kill(tanks[3], 0)
	game.kill(tanks[4], 0)
	_step(2.0)
	game.command_attack(guns.slice(0, 2), tanks[0])
	game.command_attack(guns.slice(2), tanks[1])
	var n := 0
	while n < 30 * 40:
		game.update(STEP)
		n += 1
		var rings := 0
		for f in game.fx:
			if f.kind == "ring":
				rings += 1
		if rings > 0:
			break
	_step(7 * STEP)
	world.set_zoom_level(2)
	world.look_at_tile(tanks[0].x - 0.5, tanks[0].y + 0.3)
	await _shot("c_arty")


# ─────────────────────────────────────────────────────────────── (d) a naval battle

func scene_sea() -> void:
	_make({"seed": 4242, "faction": "nato", "difficulty": 1, "mapType": "coast", "tod": "day", "weather": "clear"})
	_reveal()
	var m := game.map
	var N := m.N
	var AX := [Vector2(1, 0), Vector2(0, 1), Vector2(0.7071, 0.7071), Vector2(0.7071, -0.7071)]
	var room_at := func(cx: float, cy: float, d: Vector2) -> int:
		var k := 0
		for r in range(1, 18):
			var ok := func(x: float, y: float) -> bool:
				return m.nav(floori(x), floori(y)) and m.depth[m.idx(floori(x), floori(y))] >= 2
			if ok.call(cx + d.x * r, cy + d.y * r) and ok.call(cx - d.x * r, cy - d.y * r):
				k = r
			else:
				break
		return k
	var best := {}
	for y in range(14, N - 14):
		for x in range(14, N - 14):
			if not m.nav(x, y):
				continue
			for a in AX:
				var r: int = room_at.call(x + 0.5, y + 0.5, a)
				var sc := r * 10 + m.depth[m.idx(x, y)]
				if best.is_empty() or sc > best.sc:
					best = {"sc": sc, "x": x + 0.5, "y": y + 0.5, "a": a, "r": r}
	var cx: float = best.x
	var cy: float = best.y
	var ax: Vector2 = best.a
	var sep := mini(12, best.r - 2)
	var fleet := ["carrier", "destroyer", "corvette", "corvette", "boat", "boat", "boat"]
	var fleets := [[], []]
	for pl in 2:
		var sgn := -1 if pl == 0 else 1
		var fx := cx + ax.x * sep * sgn
		var fy := cy + ax.y * sep * sgn
		var list: Array[Ent] = []
		for k in fleet:
			list.append(game.add_unit(pl, k, fx, fy))
		var slots := game.formation(fx, fy, list, true)
		for i in list.size():
			list[i].x = slots[i].x
			list[i].y = slots[i].y
			list[i].dir = atan2(-ax.y * sgn, -ax.x * sgn)
			list[i].tdir = list[i].dir
		fleets[pl] = list
	var mid := func(l: Array) -> Vector2:
		var s := Vector2.ZERO
		for e in l:
			s += Vector2(e.x, e.y)
		return s / l.size()
	var a: Vector2 = mid.call(fleets[0])
	var b: Vector2 = mid.call(fleets[1])
	var u := (b - a).normalized()
	var pick := func(l: Array, keys: Array) -> Array:
		return l.filter(func(e): return e.key in keys)
	game.command_move(pick.call(fleets[0], ["boat", "corvette"]), b.x, b.y, true)
	game.command_move(pick.call(fleets[1], ["boat", "corvette"]), a.x, a.y, true)
	game.command_move(pick.call(fleets[0], ["destroyer"]), a.x + u.x * 5, a.y + u.y * 5, false)
	game.command_move(pick.call(fleets[1], ["destroyer"]), b.x - u.x * 5, b.y - u.y * 5, false)
	# fight until a ship has gone down and missiles are in the air
	var sunk_t := -1.0
	for i in 30 * 120:
		game.update(STEP)
		var missiles := 0
		for s in game.shots:
			if s.kind == "missile":
				missiles += 1
		var sinking := false
		for w in game.wrecks:
			if w.naval and w.t > 1.2 and w.t < 4:
				sinking = true
		if sinking and missiles >= 1:
			break
	var ships := []
	for e in game.ents:
		if e.naval and not e.dead:
			ships.append(e)
	var focus := Vector2(cx, cy)
	for w in game.wrecks:
		if w.naval:
			focus = Vector2(w.x, w.y)
	world.set_zoom_level(1)
	world.look_at_tile(focus.x, focus.y)
	await _shot("d_sea")


# ─────────────────────────────────────────────────────────────── (e) aircraft

func scene_air() -> void:
	_make({"seed": 777, "faction": "nato", "difficulty": 1, "mapType": "coast", "tod": "day", "weather": "clear"})
	_reveal()
	var hq := _hq(0)
	_clear_units()
	var cx := hq.x + 8
	var cy := hq.y + 2
	var add := func(pl: int, k: String, dx: float, dy: float, z: float, dir: float) -> Ent:
		var u := game.add_unit(pl, k, cx + dx, cy + dy)
		u.z = z
		u.dir = dir
		u.tdir = dir
		u.order = "move"
		u.dest = Vector2(u.x + cos(dir) * 5, u.y + sin(dir) * 5)
		if u.jet:
			u.js = "out"
			u.order = "strike"
			u.strike = Ent.Strike.new(null, u.dest.x, u.dest.y)
			u.jspeed = 6
		u.anim = 1
		return u
	add.call(0, "heli", -2.5, -1.5, 16, 0.35)
	add.call(1, "heli", 1.5, -3, 18, 2.6)
	add.call(0, "jet", -1, 2.5, 34, -0.6)
	add.call(1, "jet", 3, 0.5, 30, 2.2)
	add.call(0, "heli", 4.5, 3.5, 1, 1.2)
	game.time = 3.37
	world.set_zoom_level(2)
	world.look_at_tile(cx + 0.3, cy - 1.2)
	await _shot("e_air", 1, 0.0)


# ─────────────────────────────────────────────────────────────── (f) a village held, the edge of the fog

func scene_village() -> void:
	_make({"seed": 777, "faction": "nato", "difficulty": 1, "mapType": "coast", "tod": "day", "weather": "clouds"})
	var hq := _hq(0)
	# the village nearest to our base with at least three houses
	var best: Game.Garrison = null
	var bd := 1e9
	for h in game.garrisons:
		if h.kind == "bunker":
			continue
		var d := Vector2(h.x - hq.x, h.y - hq.y).length()
		var near := 0
		for o in game.garrisons:
			if Vector2(o.x - h.x, o.y - h.y).length() < 6:
				near += 1
		if near >= 3 and d < bd:
			bd = d
			best = h
	var houses: Array = []
	for o in game.garrisons:
		if o.kind != "bunker" and Vector2(o.x - best.x, o.y - best.y).length() < 7:
			houses.append(o)
	houses.sort_custom(func(a, b): return Vector2(a.x - best.x, a.y - best.y).length() < Vector2(b.x - best.x, b.y - best.y).length())
	# our squad in two houses, theirs in another
	var put := func(owner: int, h: Game.Garrison, n: int) -> void:
		for i in n:
			var w := game.pf.nearest_walkable(h.x + 1.5, h.y + 1.5)
			var u := game.add_unit(owner, "rifle" if i % 2 == 0 else "at", w.x + 0.5, w.y + 0.5)
			game._enter(u, h)
			if i == 1:
				u.hp *= 0.55
	put.call(0, houses[0], 3)
	if houses.size() > 1:
		put.call(0, houses[1], 2)
	if houses.size() > 2:
		put.call(1, houses[houses.size() - 1], 2)
	# a few of ours outside, one selected
	for i in 3:
		var w := game.pf.nearest_walkable(best.x - 2 + i, best.y + 2.5)
		var u := game.add_unit(0, "rifle", w.x + 0.5, w.y + 0.5)
		u.selected = i == 0
	houses[0].occ[0].selected = true
	game.update_fog()
	game.update(STEP)
	world.overlay["hover_g"] = houses[1] if houses.size() > 1 else null
	world.set_zoom_level(2)
	world.look_at_tile(best.x + 1, best.y + 1)
	await _shot("f_village")


# ─────────────────────────────────────────────────────────────── (g) rain

func scene_rain() -> void:
	_make({"seed": 4242, "faction": "nato", "difficulty": 1, "mapType": "land", "tod": "day", "weather": "rain"})
	_reveal()
	_clear_units()
	var hq := _hq(0)
	var c := Vector2(hq.x + 6, hq.y + 6)
	var mine: Array[Ent] = []
	var theirs: Array[Ent] = []
	for k in 6:
		var w := game.pf.nearest_walkable(c.x - 2 + (k % 3) * 1.2, c.y - 2 + (k / 3) * 1.2)
		mine.append(game.add_unit(0, ["mbt", "ifv", "rifle"][k % 3], w.x + 0.5, w.y + 0.5))
		var v := game.pf.nearest_walkable(c.x + 3 + (k % 3) * 1.2, c.y + 3 + (k / 3) * 1.2)
		theirs.append(game.add_unit(1, ["mbt", "ifv", "rifle"][k % 3], v.x + 0.5, v.y + 0.5))
	game.command_move(mine, c.x + 4, c.y + 4, true)
	game.command_move(theirs, c.x - 2, c.y - 2, true)
	_step(9.0)
	world.set_zoom_level(1)
	world.look_at_tile(c.x + 1.5, c.y + 1.5)
	await _shot("g_rain", 40, 1.0 / 30.0)
