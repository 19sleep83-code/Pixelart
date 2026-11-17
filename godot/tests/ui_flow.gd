extends Node
## The whole interface driven like a player: start from the menu (as main.gd does), then only
## synthetic input events (mouse, keys, touch) at screen positions worked out from the world
## (World.px_to_screen) and the interface's controls. Each effect on the game is checked.
##   xvfb-run -a -s "-screen 0 1600x900x24" godot --path godot --rendering-driver opengl3 \
##     --resolution 1600x900 res://tests/runner.tscn -- ui_flow
## Waiting for production is done by running the simulation ahead (as if time passed); the only
## other shortcuts: extra credits for the build chain, and the fog lifted to find a house.

const STEP := 1.0 / 30.0

var main: Node
var b: Node
var g: Game
var world: World
var inp: PlayerInput
var hud: Hud
var passed := 0
var failed := 0


func check(name_: String, ok: bool, info := "") -> void:
	if ok:
		passed += 1
		print("PASS  ", name_, ("  (" + info + ")") if info != "" else "")
	else:
		failed += 1
		print("FAIL  ", name_, ("  (" + info + ")") if info != "" else "")


# ─────────────────────────────────────────────────────────────── synthetic input

func _frames(n := 1) -> void:
	for i in n:
		await get_tree().process_frame


func _move(p: Vector2, mask := 0) -> void:
	var ev := InputEventMouseMotion.new()
	ev.position = p
	ev.global_position = p
	ev.button_mask = mask
	ev.relative = p - _last_mouse
	_last_mouse = p
	Input.parse_input_event(ev)
	await _frames(2)

var _last_mouse := Vector2.ZERO


func _button(p: Vector2, btn: MouseButton, pressed: bool, shift := false) -> void:
	var ev := InputEventMouseButton.new()
	ev.position = p
	ev.global_position = p
	ev.button_index = btn
	ev.pressed = pressed
	ev.shift_pressed = shift
	if pressed and btn <= MOUSE_BUTTON_MIDDLE:
		ev.button_mask = 1 << (btn - 1)
	Input.parse_input_event(ev)
	await _frames(2)


func _click(p: Vector2, btn := MOUSE_BUTTON_LEFT, shift := false) -> void:
	await _move(p)
	await _button(p, btn, true, shift)
	await _button(p, btn, false, shift)


func _key(code: Key, ctrl := false, shift := false) -> void:
	var ev := InputEventKey.new()
	ev.keycode = code
	ev.physical_keycode = code
	ev.ctrl_pressed = ctrl
	ev.shift_pressed = shift
	ev.pressed = true
	Input.parse_input_event(ev)
	await _frames()
	var up := ev.duplicate()
	up.pressed = false
	Input.parse_input_event(up)
	await _frames()


func _touch(i: int, p: Vector2, pressed: bool) -> void:
	var ev := InputEventScreenTouch.new()
	ev.index = i
	ev.position = p
	ev.pressed = pressed
	Input.parse_input_event(ev)
	await _frames()


func _drag(i: int, p: Vector2, rel: Vector2) -> void:
	var ev := InputEventScreenDrag.new()
	ev.index = i
	ev.position = p
	ev.relative = rel
	Input.parse_input_event(ev)
	await _frames()


func _tap(p: Vector2) -> void:
	await _touch(0, p, true)
	await _touch(0, p, false)


func _ctl(id: String) -> Vector2:
	var c := hud.control(id)
	return c.get_global_rect().get_center() if c else Vector2(-1, -1)


# ─────────────────────────────────────────────────────────────── the world

func _ff(sec: float) -> void:
	for i in int(sec * 30):
		g.update(STEP)
		b.get("ai").update(STEP)
	await _frames(2)


## where a unit is picked on the screen (a building: a point of its footprint where nothing else
## is picked)
func _at(e: Ent) -> Vector2:
	if e.is_b:
		for fy in [0.5, 0.8, 0.2]:
			for fx in [0.5, 0.8, 0.2]:
				var q := _tile_screen(e.tx + e.w * fx, e.ty + e.h * fy)
				if world.pick(world.screen_to_px(q)) == e:
					return q
	var up := 24.0 if e.is_b else (16.0 if e.infantry or e.naval else 12.0)
	return world.px_to_screen(world.tile_to_px(e.x, e.y, e.z) - Vector2(0, up))


## bring an entity into the safe part of the view (camera only) and give its screen point
func _show(e: Ent) -> Vector2:
	if not _safe(_at(e)):
		inp.look_at(e.x, e.y)
		await _frames(2)
	return _at(e)


func _tile_screen(x: float, y: float) -> Vector2:
	return world.px_to_screen(world.tile_to_px(x, y))


func _safe(p: Vector2) -> bool:
	var v := inp.view_rect()
	return p.x > 40 and p.y > 70 and p.x < v.size.x - 140 and p.y < v.size.y - 160


func _mine(key: String) -> Array[Ent]:
	var out: Array[Ent] = []
	for e in g.ents:
		if e.owner == 0 and e.key == key and not e.dead:
			out.append(e)
	return out


func _hq() -> Ent:
	return _mine("hq")[0]


## queue a building from the sidebar, wait for it, place it on the field by mouse
func _build(key: String) -> Ent:
	await _key(KEY_F1)
	await _click(_ctl("Item_" + key))
	for i in 90:
		var q: Array = g.me.queues["build"]
		if not q.is_empty() and q[0].ready:
			break
		await _ff(1)
	await _click(_ctl("Item_" + key))
	if inp.place != key:
		return null
	await _key(KEY_H)
	var def: Dictionary = g.bdefs[key]
	var hq := _hq()
	var spot := Vector2(-1, -1)
	for r in range(2, 9):
		for dy in range(-r, r + 1):
			for dx in range(-r, r + 1):
				if spot.x >= 0 or maxi(absi(dx), absi(dy)) != r:
					continue
				var tx := hq.tx + dx
				var ty := hq.ty + dy
				if not g.can_place(0, key, tx, ty):
					continue
				var p := _tile_screen(tx + def["w"] / 2.0, ty + def["h"] / 2.0)
				if _safe(p):
					spot = p
	if spot.x < 0:
		return null
	var before := _mine(key).size()
	await _click(spot)
	await _ff(2.5)  # (it rises)
	var list := _mine(key)
	return list[list.size() - 1] if list.size() > before else null


# ─────────────────────────────────────────────────────────────── the run

func run(_args: PackedStringArray) -> void:
	Settings.set_value("view", "zoom", 0)
	UiTheme.force_scale = 2
	UiTheme.force_touch = 1  # both: the touch buttons are there, the mouse works as on a PC
	main = load("res://scripts/main.gd").new()
	add_child(main)
	await _frames(5)
	var menu: Menu = main.get("menu")
	check("menu shown", menu != null)
	menu.opts.merge({"faction": "nato", "difficulty": 0, "mapType": "land", "tod": "day", "weather": "clear"}, true)
	menu._seed_edit.text = "4242"
	var start_btn: Button = null
	for c in menu.find_children("*", "Button", true, false):
		if c.text == "Gefecht beginnen":
			start_btn = c
	await _click(start_btn.get_global_rect().get_center())
	await _frames(5)
	b = main.get("battle")
	check("menu → battle", b != null and main.get("menu") == null)
	if b == null:
		_end()
		return
	g = b.get("game")
	world = b.get("world")
	inp = b.get("input")
	hud = b.get("hud")
	await _frames(10)
	check("map and seed from the menu", g.opts["seed"] == 4242 and g.map.type == "land")
	await _selection()
	await _commands()
	await _keys()
	await _view()
	await _sidebar()
	await _rally_and_units()
	await _garrison()
	await _touch_tests()
	await _sell()
	await _pause()
	_end()


func _selection() -> void:
	await _key(KEY_H)
	var rifles := _mine("rifle")
	var ifv: Ent = _mine("ifv")[0]
	var r0 := world.pick(world.screen_to_px(_at(rifles[0])))  # (the soldiers stand close: the topmost)
	await _click(_at(r0))
	check("click selects", inp.sel.size() == 1 and inp.sel[0] == r0 and r0.selected, str(inp.sel.size()))
	await _frames(12)  # not a double click
	await _click(_at(ifv), MOUSE_BUTTON_LEFT, true)
	check("shift-click adds", inp.sel.size() == 2 and inp.sel.has(ifv), str(inp.sel.size()))
	await _click(_at(r0))
	await _click(_at(r0))
	check("double click: all of that kind in view", inp.sel.size() == 3 and inp.sel.all(func(e: Ent) -> bool: return e.key == "rifle"), str(inp.sel.size()))
	await _frames(12)
	# empty ground deselects
	var hq := _hq()
	await _click(_tile_screen(hq.x - 4, hq.y + 4))
	check("click on the ground deselects", inp.sel.is_empty())
	# box around all four starting units
	var lo := Vector2(1e9, 1e9)
	var hi := Vector2(-1e9, -1e9)
	for e in rifles + [ifv]:
		var s := world.px_to_screen(world.tile_to_px(e.x, e.y, e.z))
		lo = lo.min(s)
		hi = hi.max(s)
	await _move(lo - Vector2(30, 40))
	await _button(lo - Vector2(30, 40), MOUSE_BUTTON_LEFT, true)
	await _move((lo + hi) / 2.0, 1)
	await _move(hi + Vector2(30, 20), 1)
	check("box shown while dragging", world.overlay["box"] is Rect2)
	await _button(hi + Vector2(30, 20), MOUSE_BUTTON_LEFT, false)
	check("box select", inp.sel.size() == 4 and world.overlay["box"] == null, str(inp.sel.size()))
	# the selection panel: grouped icons
	check("selection panel groups", hud.control("Group_rifle") != null and hud.control("Group_ifv") != null)


func _commands() -> void:
	var hq := _hq()
	var target := _tile_screen(hq.x - 3, hq.y + 5)
	var cm := await _cursor_at(target)
	check("cursor: move", cm == "move", cm)
	await _click(target, MOUSE_BUTTON_RIGHT)
	var orders := inp.sel.map(func(e: Ent) -> String: return e.order)
	check("right click moves", orders.all(func(o: String) -> bool: return o == "move") and world.overlay["move_mark"] != null, str(orders))
	await _ff(1)
	# attack-move: A, then a left click
	await _key(KEY_A)
	check("A: attack mode", inp.attack_mode)
	check("cursor: attack", await _cursor_at(_tile_screen(hq.x - 5, hq.y + 3)) == "attack", inp.cursor_name())
	await _click(_tile_screen(hq.x - 5, hq.y + 3))
	var ok := inp.sel.all(func(e: Ent) -> bool: return e.order == "amove" and e.amove != null)
	check("attack-move", ok and not inp.attack_mode, str(inp.sel.map(func(e: Ent) -> String: return e.order)))
	# right click cancels the attack mode
	await _key(KEY_A)
	await _click(_tile_screen(hq.x - 5, hq.y + 3), MOUSE_BUTTON_RIGHT)
	check("right click leaves attack mode", not inp.attack_mode)
	await _key(KEY_S)
	check("S stops", inp.sel.all(func(e: Ent) -> bool: return e.order == "idle"), str(inp.sel.map(func(e: Ent) -> String: return e.order)))


func _cursor_at(p: Vector2) -> String:
	await _move(p)
	await _frames(2)
	return inp.cursor_name()


func _keys() -> void:
	var n := inp.sel.size()
	await _key(KEY_1, true)
	check("Ctrl+1 forms a group", inp.groups.has(1) and inp.groups[1].size() == n)
	await _key(KEY_ESCAPE)
	check("Esc deselects", inp.sel.is_empty())
	await _key(KEY_1)
	check("1 recalls the group", inp.sel.size() == n)
	# away from the group, then 1 twice: jump there
	await _key(KEY_H)
	world.pan_screen(Vector2(-600, 300))
	await _frames()
	var cam := world.camera.position
	await _key(KEY_1)
	await _key(KEY_1)
	var c := inp.view_rect().get_center()
	var s := _tile_screen(inp.sel[0].x, inp.sel[0].y)
	check("1 twice jumps to the group", world.camera.position != cam and s.distance_to(c) < 40, "%s from the middle" % (s - c))
	await _key(KEY_H)
	var hq := _hq()
	check("H: headquarters in the middle", _tile_screen(hq.x, hq.y).distance_to(inp.view_rect().get_center()) < 40)
	await _key(KEY_SPACE)
	check("Space: to the selection", _tile_screen(inp.sel[0].x, inp.sel[0].y).distance_to(inp.view_rect().get_center()) < 40)
	await _key(KEY_Q)
	check("Q: whole army", inp.sel.size() >= 4)
	await _key(KEY_E)
	check("E: fighters in view", inp.sel.size() >= 1)


func _view() -> void:
	await _key(KEY_H)
	var p := Vector2(400, 300)
	var lv := world.zoom_level
	var w0 := world.screen_to_px(p)
	await _move(p)
	await _button(p, MOUSE_BUTTON_WHEEL_UP, true)
	await _button(p, MOUSE_BUTTON_WHEEL_UP, false)
	var w1 := world.screen_to_px(p)
	check("wheel zooms in at the cursor", world.zoom_level == lv + 1 and w0.distance_to(w1) < 2.0, "%d → %d, moved %.1f" % [lv, world.zoom_level, w0.distance_to(w1)])
	check("zoom remembered", int(Settings.get_value("view", "zoom", 0)) == world.zoom_level - inp.base_zoom())
	await _button(p, MOUSE_BUTTON_WHEEL_DOWN, true)
	await _button(p, MOUSE_BUTTON_WHEEL_DOWN, false)
	check("wheel zooms out", world.zoom_level == lv)
	# pinch: two fingers apart, then together
	var c := Vector2(600, 450)
	await _touch(0, c - Vector2(80, 0), true)
	await _touch(1, c + Vector2(80, 0), true)
	await _drag(0, c - Vector2(130, 0), Vector2(-50, 0))
	await _drag(1, c + Vector2(130, 0), Vector2(50, 0))
	await _touch(0, c - Vector2(130, 0), false)
	await _touch(1, c + Vector2(130, 0), false)
	check("pinch zooms in", world.zoom_level == lv + 1, str(world.zoom_level))
	await _touch(0, c - Vector2(150, 0), true)
	await _touch(1, c + Vector2(150, 0), true)
	await _drag(0, c - Vector2(90, 0), Vector2(60, 0))
	await _drag(1, c + Vector2(90, 0), Vector2(-60, 0))
	await _touch(0, c - Vector2(90, 0), false)
	await _touch(1, c + Vector2(90, 0), false)
	check("pinch zooms out", world.zoom_level == lv, str(world.zoom_level))
	# middle button drag
	var cam := world.camera.position
	await _move(c)
	await _button(c, MOUSE_BUTTON_MIDDLE, true)
	await _move(c + Vector2(-100, -50), 4)
	await _button(c + Vector2(-100, -50), MOUSE_BUTTON_MIDDLE, false)
	var d := world.camera.position - cam
	check("middle drag pans", d.distance_to(Vector2(100, 50) / world.zoom) < 2.0, str(d))
	# one finger drag
	cam = world.camera.position
	await _touch(0, c, true)
	await _drag(0, c + Vector2(60, 0), Vector2(60, 0))
	await _drag(0, c + Vector2(120, 40), Vector2(60, 40))
	await _touch(0, c + Vector2(120, 40), false)
	d = world.camera.position - cam
	check("finger drag pans", d.distance_to(Vector2(-120, -40) / world.zoom) < 2.0, str(d))
	# arrow keys
	cam = world.camera.position
	var ev := InputEventKey.new()
	ev.keycode = KEY_RIGHT
	ev.physical_keycode = KEY_RIGHT
	ev.pressed = true
	Input.parse_input_event(ev)
	await _frames(10)
	var up := ev.duplicate()
	up.pressed = false
	Input.parse_input_event(up)
	await _frames()
	check("arrow key scrolls", world.camera.position.x > cam.x + 20, str(world.camera.position - cam))
	# the screen edge
	cam = world.camera.position
	await _move(Vector2(2, 450))
	await _frames(10)
	check("screen edge scrolls", world.camera.position.x < cam.x - 20, str(world.camera.position - cam))
	await _move(Vector2(600, 450))
	# the situation map: click → the view goes there
	var hq := _hq()
	var mini: MiniMap = hud.control("MiniMap")
	var mp: Vector2 = mini.get_global_rect().position + mini._to_local(world.tile_to_px(hq.x + 10, hq.y + 10))
	await _click(mp)
	check("minimap click moves the view", _tile_screen(hq.x + 10, hq.y + 10).distance_to(inp.view_rect().get_center()) < 20)


func _sidebar() -> void:
	await _key(KEY_H)
	# the data card on hover
	await _move(_ctl("Item_power"))
	await _frames(2)
	check("data card on hover", hud.card_visible())
	await _move(Vector2(600, 450))
	check("data card hides", not hud.card_visible())
	# queue a power plant with a click
	await _click(_ctl("Item_power"))
	var q: Array = g.me.queues["build"]
	check("click queues a power plant", q.size() == 1 and q[0].key == "power")
	await _frames(8)
	var st: Label = hud._btns[0]["state"]
	check("progress shown", st.text.ends_with("%"), st.text)
	for i in 20:
		if q[0].ready:
			break
		await _ff(1)
	await _frames(8)
	check("ready shown", hud._btns[0]["state"].text == "Bereit")
	await _click(_ctl("Item_power"))
	check("click on the finished building: placing", inp.place == "power" and world.overlay["place"] is Dictionary)
	await _move(Vector2(600, 450))
	check("cursor: place", inp.cursor_name() == "place")
	# right click leaves placing; the building stays ready
	await _click(Vector2(600, 450), MOUSE_BUTTON_RIGHT)
	check("right click cancels placing", inp.place == "" and q.size() == 1)
	# place it (the helper finds a free spot near the HQ and clicks there)
	q.clear()
	g.me.credits += 6000  # (test: enough money for the chain to the tank factory)
	var pw := await _build("power")
	check("power plant placed by mouse", pw != null and inp.place == "")
	var ref := await _build("ref")
	check("refinery placed", ref != null)
	var bar := await _build("barracks")
	check("barracks placed", bar != null)
	var fac := await _build("factory")
	check("factory placed", fac != null)
	await _ff(3)  # rise
	# a building already being built blocks the next one
	await _click(_ctl("Item_radar"))
	await _click(_ctl("Item_bunker"))
	check("only one building at a time", g.me.queues["build"].size() == 1)
	await _click(_ctl("Item_radar"), MOUSE_BUTTON_RIGHT)
	check("right click cancels the building", g.me.queues["build"].is_empty())


func _rally_and_units() -> void:
	# F2: infantry tab; two riflemen, cancel one with a right click
	await _key(KEY_F2)
	check("F2: infantry tab", hud.tab == "inf")
	await _click(_ctl("Item_rifle"))
	await _click(_ctl("Item_rifle"))
	await _click(_ctl("Item_engineer"))
	var q: Array = g.me.queues["inf"]
	check("infantry queued", q.size() == 3, str(q.size()))
	await _frames(8)
	check("queue count shown", hud._btns[0]["badge"].text == "2", hud._btns[0]["badge"].text)
	await _click(_ctl("Item_engineer"), MOUSE_BUTTON_RIGHT)
	check("right click cancels one", q.size() == 2, str(q.size()))
	# F3 and the item hotkey: a tank (Leopard is the fourth vehicle: key V)
	await _key(KEY_F3)
	var keys: Array = hud._btns.map(func(x: Dictionary) -> String: return x["key"])
	var i := keys.find("mbt")
	await _key(Hud.KEYS[i][0])
	check("item hotkey queues a tank", g.me.queues["veh"].any(func(it: Game.QItem) -> bool: return it.key == "mbt"), str(Hud.KEYS[i][1]))
	await _key(KEY_TAB)
	check("Tab: next tab", hud.tab == "air")
	# rally point: select the barracks, right click on the ground
	var bar: Ent = _mine("barracks")[0]
	await _key(KEY_H)
	var bp := await _show(bar)
	await _click(bp)
	check("click selects a building", inp.sel.size() == 1 and inp.sel[0] == bar)
	var hq := _hq()
	var rp := _tile_screen(hq.x - 4, hq.y + 6)
	await _click(rp, MOUSE_BUTTON_RIGHT)
	check("right click sets a rally point", bar.rally != null and Vector2(bar.rally).distance_to(Vector2(hq.x - 4, hq.y + 6)) < 0.2, str(bar.rally))
	# primary building button
	await _click(_ctl("Act_primary"))
	check("primary building button", g.me.primary.get("inf", -1) == bar.id)
	var n0 := _mine("rifle").size()
	for k in 30:
		if _mine("rifle").size() > n0:
			break
		await _ff(1)
	var fresh := _mine("rifle")
	var r: Ent = fresh[fresh.size() - 1]
	check("rifleman built and sent to the rally point", fresh.size() > n0 and r.dest != null and Vector2(r.dest).distance_to(Vector2(bar.rally)) < 2.5, str(r.dest))


func _garrison() -> void:
	# the nearest house to our HQ (fog lifted to find it)
	g.reveal = true
	await _ff(0.5)
	var hq := _hq()
	var house: Game.Garrison = null
	for h in g.garrisons:
		if h.kind == "house" and h.owner == -1 and (house == null or absf(h.x - hq.x) + absf(h.y - hq.y) < absf(house.x - hq.x) + absf(house.y - hq.y)):
			house = h
	check("a house on the map", house != null)
	if house == null:
		return
	# riflemen: double click one
	var rifles := _mine("rifle")
	await _key(KEY_H)
	var r0 := world.pick(world.screen_to_px(await _show(rifles[0])))
	await _click(_at(r0))
	await _click(_at(r0))
	var sel := inp.sel.duplicate()
	check("riflemen selected for the house", sel.size() >= 2, str(sel.size()))
	# over to the house with the minimap, then a right click on it
	var mini: MiniMap = hud.control("MiniMap")
	await _click(mini.get_global_rect().position + mini._to_local(world.tile_to_px(house.x, house.y)))
	var hp := _tile_screen(house.x, house.y)
	check("cursor: enter", await _cursor_at(hp) == "enter", inp.cursor_name())
	await _click(hp, MOUSE_BUTTON_RIGHT)
	check("right click on a house: enter", sel.any(func(e: Ent) -> bool: return e.order == "enter" or e.inside != null), str(sel.map(func(e: Ent) -> String: return e.order)))
	for k in 60:
		if sel.all(func(e: Ent) -> bool: return e.inside != null or e.order != "enter"):
			break
		await _ff(1)
	var inside := sel.filter(func(e: Ent) -> bool: return e.inside != null)
	check("soldiers inside the house", not inside.is_empty() and house.owner == 0, "%d inside" % inside.size())
	await _frames(8)
	check("selection panel: Räumen", hud.control("Act_exit") != null or inp.sel.size() > 1)
	await _key(KEY_D)
	await _ff(3)
	check("D: they leave the house", sel.all(func(e: Ent) -> bool: return e.inside == null), str(house.occ.size()))


func _touch_tests() -> void:
	await _key(KEY_ESCAPE)
	await _key(KEY_H)
	var tank: Ent = _mine("ifv")[0]
	var tp := _at(tank)
	if not _safe(tp):
		inp.look_at(tank.x, tank.y)
		await _frames(2)
		tp = _at(tank)
	await _tap(tp)
	check("tap selects", inp.sel.size() == 1 and inp.sel[0] == tank)
	await _frames(12)
	var hq := _hq()
	var to := _tile_screen(tank.x - 2, tank.y + 2)
	await _tap(to)
	check("tap with a selection moves", tank.order == "move", tank.order)
	# long press: attack-move
	var lp := _tile_screen(tank.x - 3, tank.y + 1)
	await _touch(0, lp, true)
	for i in 40:
		await _frames()
		if tank.order == "amove":
			break
	await _touch(0, lp, false)
	check("long press: attack-move", tank.order == "amove", tank.order)
	# the box button, then a finger frame around the soldiers
	await _click(_ctl("BoxSelect"))
	check("box button on", inp.box_mode)
	var rifles := _mine("rifle")
	inp.look_at(rifles[0].x, rifles[0].y)
	await _frames(2)
	rifles = rifles.filter(func(e: Ent) -> bool: return _safe(_at(e)))
	var lo := Vector2(1e9, 1e9)
	var hi := Vector2(-1e9, -1e9)
	for e in rifles:
		var s := world.px_to_screen(world.tile_to_px(e.x, e.y, e.z))
		lo = lo.min(s)
		hi = hi.max(s)
	await _touch(0, lo - Vector2(60, 60), true)
	await _drag(0, (lo + hi) / 2.0, (lo + hi) / 2.0 - lo)
	await _drag(0, hi + Vector2(60, 60), hi - (lo + hi) / 2.0)
	await _touch(0, hi + Vector2(60, 60), false)
	var vis := rifles.filter(func(e: Ent) -> bool: return inp.view_rect().has_point(_at(e)))
	check("finger frame selects", inp.sel.size() > 0 and vis.all(func(e: Ent) -> bool: return inp.sel.has(e)) and inp.sel.all(func(e: Ent) -> bool: return not e.is_b and e.owner == 0), "%d selected, %d soldiers in the frame" % [inp.sel.size(), vis.size()])
	await _click(_ctl("BoxSelect"))
	check("box button off", not inp.box_mode)
	await _click(_ctl("Deselect"))
	check("deselect button", inp.sel.is_empty())


func _sell() -> void:
	await _key(KEY_H)
	var pw: Ent = _mine("power")[0]
	await _key(KEY_ESCAPE)
	var pp := await _show(pw)
	var ph := world.pick(world.screen_to_px(pp))
	print("  debug: pw at %s picks %s, safe %s, place '%s' attack %s hovered %s" % [pp, ph.key if ph else "-", _safe(pp), inp.place, inp.attack_mode, get_viewport().gui_get_hovered_control()])
	await _click(pp)
	print("  debug: sel ", inp.sel.map(func(e: Ent) -> String: return e.key))
	check("click selects the power plant", inp.sel.size() == 1 and inp.sel[0] == pw)
	await _frames(8)
	var cr := g.me.credits
	await _click(_ctl("Act_repair"))
	check("repair button", pw.repairing)
	await _click(_ctl("Act_sell"))
	check("sell button", pw.dead or not g.by_id.has(pw.id), "credits %+d" % int(g.me.credits - cr))
	check("selection cleared after selling", inp.sel.is_empty())


func _pause() -> void:
	await _key(KEY_P)
	var scr: BattleScreens = b.get("screens")
	check("P pauses", b.get("paused") and scr.visible)
	var t := g.time
	await _frames(10)
	check("paused: time stands", g.time == t)
	await _key(KEY_P)
	check("P resumes", not b.get("paused") and not scr.visible)
	await _click(_ctl("MenuButton"))
	check("menu button pauses", b.get("paused"))
	var resume: Button = scr.find_child("Resume", true, false)
	await _click(resume.get_global_rect().get_center())
	check("Weiter resumes", not b.get("paused"))
	await _key(KEY_F10)
	var quit: Button = scr.find_child("Quit", true, false)
	await _click(quit.get_global_rect().get_center())
	await _frames(5)
	check("back to the main menu", main.get("menu") != null and main.get("battle") == null)


func _end() -> void:
	Settings.set_value("view", "zoom", 0)
	print("ui_flow: %d passed, %d failed" % [passed, failed])
	main.queue_free()
	await _frames(2)
