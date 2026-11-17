extends Node
## The computer against itself with the world drawn every tick, to catch errors in the renderer and
## to measure it:
##   xvfb-run -a -s "-screen 0 1600x900x24" godot --path godot --rendering-driver opengl3 \
##     res://tests/runner.tscn -- view_aivai [minutes=3] [seed:map=7:coast] [zoom level=1] [shots dir] [warm-up minutes=0]
## (the warm-up is simulated without drawing, to get to the fighting sooner; the fog is off)
##   … -- view_aivai stress [per side=75] [seed:map=4242:land] [zoom level=1] [seconds=20] [shots dir]
## Prints the time the world takes to fill its layers (redraw, CPU) and the whole frame (wall clock,
## with the GPU work of the previous frame), every 30 s and at the end.

const STEP := 1.0 / 30.0

var game: Game
var world: World
var ais: Array[AI] = []
var _draw := PackedFloat64Array()
var _frame := PackedFloat64Array()
var _sim := PackedFloat64Array()


func run(args: PackedStringArray) -> void:
	Engine.max_fps = 0
	DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
	if args.size() > 0 and args[0] == "stress":
		await _stress(args.slice(1))
		return
	var minutes := float(args[0]) if args.size() > 0 else 3.0
	var sm := (args[1] if args.size() > 1 else "7:coast").split(":")
	var zl := int(args[2]) if args.size() > 2 else 1
	var shots: String = args[3] if args.size() > 3 else ""
	var warm := float(args[4]) if args.size() > 4 else 0.0
	_make({"seed": int(sm[0]), "faction": "nato", "difficulty": 2, "mapType": sm[1], "tod": "dusk", "weather": "clouds"}, zl)
	var a0 := AI.new(game)
	a0.p = 0
	game.players[0].ai = true
	ais = [a0, AI.new(game)]
	game.reveal = true
	for i in int(warm * 60 * 30):
		game.update(STEP)
		for a in ais:
			a.update(STEP)
	if warm > 0:
		print("warm-up done at %.0f s" % game.time)
	var focus := Vector2(game.map.N / 2.0, game.map.N / 2.0)
	var cam := focus
	var next := 0.0
	var ticks := int(minutes * 60 * 30)
	var t_last := Time.get_ticks_usec()
	for i in ticks:
		var t0 := Time.get_ticks_usec()
		game.update(STEP)
		for a in ais:
			a.update(STEP)
		var t1 := Time.get_ticks_usec()
		_sim.append((t1 - t0) / 1000.0)
		# the camera drifts to wherever the fighting is (as the title screen does)
		if game.time > next:
			next = game.time + 9
			focus = _fight(focus)
		cam += (focus - cam) * minf(1, STEP * 0.4)
		world.look_at_tile(cam.x, cam.y)
		world.redraw(STEP)
		_draw.append(world.draw_ms)
		await get_tree().process_frame
		var t2 := Time.get_ticks_usec()
		_frame.append((t2 - t_last) / 1000.0)
		t_last = t2
		if (i + 1) % (30 * 30) == 0:
			_report("%d:%02d" % [int(game.time) / 60, int(game.time) % 60])
			if shots != "" and shots != "-":
				get_viewport().get_texture().get_image().save_png(shots.path_join("aivai_%03d.png" % int(game.time)))
		if game.over != 0:
			print("game over: ", game.over, " at ", game.time)
			break
	_report("end")
	var lost := [game.players[0].stats.lost, game.players[1].stats.lost]
	print("units lost: ", lost, "  built: ", [game.players[0].stats.built, game.players[1].stats.built])
	world.queue_free()
	game.dispose()


func _make(opts: Dictionary, zl: int) -> void:
	game = Game.new(opts)
	world = World.new()
	add_child(world)
	world.setup(game)
	world.auto_draw = false
	world.profile = {}
	world.set_zoom_level(zl)


func _fight(focus: Vector2) -> Vector2:
	var best := focus
	var bs := -1
	for e in game.ents:
		if e.is_b or e.dead:
			continue
		var n := 2 if e.naval else 0
		for o in game.ents:
			if not o.is_b and o.owner != e.owner and absf(o.x - e.x) + absf(o.y - e.y) < 9:
				n += 1
		if n > bs:
			bs = n
			best = Vector2(e.x, e.y)
	return best


func _report(label: String) -> void:
	var units := 0
	for e in game.ents:
		if not e.is_b:
			units += 1
	var on := 0
	for e in game.ents:
		if not e.is_b and world.shown(e) and world._on_screen(e.x, e.y):
			on += 1
	if world.profile != null:
		var parts := []
		for k in world.profile:
			parts.append("%s %.2f" % [k.trim_prefix("_draw_"), world.profile[k] / 1000.0 / maxf(1, _draw.size())])
		print("   ms/frame: ", ", ".join(parts))
		world.profile = {}
	print("%s  units %d (in view %d) fx %d shots %d | redraw avg %.2f max %.2f ms | frame avg %.1f p95 %.1f ms | sim avg %.2f ms" % [
		label, units, on, game.fx.size(), game.shots.size(), _avg(_draw), _max(_draw), _avg(_frame), _pct(_frame, 0.95), _avg(_sim)])
	_draw.clear()
	_frame.clear()
	_sim.clear()


static func _avg(a: PackedFloat64Array) -> float:
	if a.is_empty():
		return 0.0
	var s := 0.0
	for v in a:
		s += v
	return s / a.size()


static func _max(a: PackedFloat64Array) -> float:
	var m := 0.0
	for v in a:
		m = maxf(m, v)
	return m


static func _pct(a: PackedFloat64Array, p: float) -> float:
	if a.is_empty():
		return 0.0
	var b := a.duplicate()
	b.sort()
	return b[mini(b.size() - 1, int(b.size() * p))]


## a big fight in one place: n units a side, all in view
func _stress(args: PackedStringArray) -> void:
	var per := int(args[0]) if args.size() > 0 else 75
	var sm := (args[1] if args.size() > 1 else "4242:land").split(":")
	var zl := int(args[2]) if args.size() > 2 else 1
	var secs := float(args[3]) if args.size() > 3 else 20.0
	var shots: String = args[4] if args.size() > 4 else ""
	_make({"seed": int(sm[0]), "faction": "nato", "difficulty": 1, "mapType": sm[1], "tod": "night", "weather": "clear"}, zl)
	game.reveal = true
	game.update_fog()
	var a := game.players[0]
	var hq0: Ent = null
	var hq1: Ent = null
	for e in game.ents:
		if e.key == "hq":
			if e.owner == 0: hq0 = e
			else: hq1 = e
	var c := Vector2(hq0.x, hq0.y).lerp(Vector2(hq1.x, hq1.y), 0.5)
	var mix := ["mbt", "ifv", "rifle", "rifle", "at", "aa", "art", "scout", "heli"]
	var sides: Array = [[], []]
	for p in 2:
		var off := Vector2(-4, -4) if p == 0 else Vector2(4, 4)
		for k in per:
			var key: String = mix[k % mix.size()]
			var w := game.pf.nearest_walkable(c.x + off.x + (k % 10) * 0.7 - 3, c.y + off.y + (k / 10) * 0.7 - 3, 14)
			var u := game.add_unit(p, key, w.x + 0.5, w.y + 0.5)
			if u.air:
				u.z = 16
			sides[p].append(u)
	game.command_move(sides[0], c.x + 4, c.y + 4, true)
	game.command_move(sides[1], c.x - 4, c.y - 4, true)
	world.look_at_tile(c.x, c.y)
	var t_last := Time.get_ticks_usec()
	for i in int(secs * 30):
		var t0 := Time.get_ticks_usec()
		game.update(STEP)
		_sim.append((Time.get_ticks_usec() - t0) / 1000.0)
		world.redraw(STEP)
		_draw.append(world.draw_ms)
		await get_tree().process_frame
		var t2 := Time.get_ticks_usec()
		_frame.append((t2 - t_last) / 1000.0)
		t_last = t2
		if i == 90 and shots != "" and shots != "-":
			get_viewport().get_texture().get_image().save_png(shots.path_join("stress.png"))
		if (i + 1) % 150 == 0:
			_report("%.0f s" % game.time)
