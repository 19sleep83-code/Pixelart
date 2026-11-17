class_name PlayerInput
extends Node
## Mouse, keyboard and touch (port of src/game/input.ts): select with a click or a dragged frame,
## command with the right button, move the view with the arrow keys, the screen edges or the middle
## button, zoom with the wheel at the cursor.
##
## Touch (phones, tablets): a tap selects or, with a selection of our own, commands like a right
## click; a long press is an attack-move; one finger drags the view (or, with the box button of the
## interface on, draws a selection frame); two fingers pinch to zoom and move the view.
##
## Screen positions are viewport pixels; the world converts them (World.screen_to_px). The view is
## the screen left of the sidebar (`hud.side_width()`).

## the selection or a mode changed (the interface rebuilds its selection panel)
signal changed
## P / F10 / the back button
signal pause_requested

const DOUBLE_MS := 350
const GROUP_MS := 400
const LONG_MS := 550

var game: Game
var world: World
## the interface: side_width(), hotkey(ev) -> bool (may be null)
var hud: Node
var sel: Array[Ent] = []
var groups := {}
## the building being placed ("" none)
var place := ""
var attack_mode := false
var paused := false
## touch: one finger draws a selection frame instead of moving the view
var box_mode := false
## UI scale (cursor size, touch distances)
var ui_scale := 2

var mouse := Vector2.ZERO
var mouse_inside := false
var _mouse_seen := false
var _in_window := true
var _focus := true
var _down: Variant = null  # Vector2 where the left button went down
var _pan := false
var _keys := {}
var _last_click := {"t": -100000, "id": 0}
var _last_group := {"n": -1, "t": -100000}
var _cursor := -1
# touch
var _touches := {}  # index -> Vector2
var _t_mode := ""  # "" | tap | pan | box | pinch
var _t_start := Vector2.ZERO
var _t_time := 0
var _t_long := false
var _pinch_d := 0.0
var _pinch_mid := Vector2.ZERO
var _magnify := 1.0


func _now() -> int:
	return Time.get_ticks_msec()


## the part of the screen that shows the field
func view_rect() -> Rect2:
	var s := get_viewport().get_visible_rect().size
	var sw: float = hud.side_width() if hud and hud.has_method("side_width") else 0.0
	return Rect2(0, 0, s.x - sw, s.y)


func _px(p: Vector2) -> Vector2:
	return world.screen_to_px(p)


## a world position (tiles) to the screen
func _screen_of(x: float, y: float, z := 0.0) -> Vector2:
	return world.px_to_screen(world.tile_to_px(x, y, z))


func _tile_at(p: Vector2) -> Vector2:
	return world.px_to_tile(_px(p))


## centre the visible part of the view (left of the sidebar) on a tile
func look_at(x: float, y: float) -> void:
	world.look_at_tile(x, y)
	var s := get_viewport().get_visible_rect().size
	var v := view_rect()
	world.pan_screen(Vector2(s.x / 2.0 - v.size.x / 2.0, 0).round())


func _shift() -> bool:
	return Input.is_key_pressed(KEY_SHIFT)


# ─────────────────────────────────────────────────────────────── events

func _notification(what: int) -> void:
	match what:
		NOTIFICATION_APPLICATION_FOCUS_OUT, NOTIFICATION_WM_WINDOW_FOCUS_OUT:
			_focus = false
			_keys.clear()
		NOTIFICATION_APPLICATION_FOCUS_IN, NOTIFICATION_WM_WINDOW_FOCUS_IN:
			_focus = true
		NOTIFICATION_WM_MOUSE_EXIT:
			_in_window = false
		NOTIFICATION_WM_MOUSE_ENTER:
			_in_window = true
		NOTIFICATION_EXIT_TREE:
			Input.set_default_cursor_shape(Input.CURSOR_ARROW)


## what must be seen even over the interface: keys held, the mouse moving, buttons let go, fingers
## that began on the field
func _input(ev: InputEvent) -> void:
	if ev is InputEventKey:
		var k := ev as InputEventKey
		if k.pressed:
			_keys[k.keycode] = true
		else:
			_keys.erase(k.keycode)
		return
	if ev is InputEventMouseMotion:
		var mm := ev as InputEventMouseMotion
		_mouse_seen = true
		_in_window = true
		if _pan:
			world.pan_screen(-mm.relative)
			return
		mouse = mm.position
		if _down != null:
			var d: Vector2 = _down
			if absf(mouse.x - d.x) + absf(mouse.y - d.y) > 3.0 * world.zoom:
				world.overlay["box"] = Rect2(d, mouse - d)
		return
	if ev is InputEventMouseButton:
		var mb := ev as InputEventMouseButton
		if mb.pressed:
			return
		if mb.button_index == MOUSE_BUTTON_MIDDLE and _pan:
			_pan = false
			get_viewport().set_input_as_handled()
		elif mb.button_index == MOUSE_BUTTON_LEFT and _down != null:
			_left_up(mb.position, mb.shift_pressed)
			get_viewport().set_input_as_handled()
		return
	if ev is InputEventScreenDrag:
		var sd := ev as InputEventScreenDrag
		if _touches.has(sd.index):
			_touch_drag(sd.index, sd.position)
			get_viewport().set_input_as_handled()
		return
	if ev is InputEventScreenTouch:
		var st := ev as InputEventScreenTouch
		if not st.pressed and _touches.has(st.index):
			_touch_up(st.index, st.position, st.canceled)
			get_viewport().set_input_as_handled()


## what reaches the field (not taken by the interface)
func _unhandled_input(ev: InputEvent) -> void:
	if ev is InputEventMouseButton and ev.pressed:
		_mouse_down(ev as InputEventMouseButton)
		get_viewport().set_input_as_handled()
	elif ev is InputEventKey and ev.pressed and not ev.echo:
		if _key(ev as InputEventKey):
			get_viewport().set_input_as_handled()
	elif ev is InputEventScreenTouch and ev.pressed:
		_touch_down(ev.index, ev.position)
		get_viewport().set_input_as_handled()
	elif ev is InputEventMagnifyGesture:
		# trackpads: pinch
		_magnify *= ev.factor
		if _magnify > 1.25 or _magnify < 0.8:
			zoom_step(1 if _magnify > 1.0 else -1, ev.position)
			_magnify = 1.0
	elif ev is InputEventPanGesture:
		world.pan_screen(ev.delta * 12.0)


func _mouse_down(e: InputEventMouseButton) -> void:
	var p := e.position
	mouse = p
	_mouse_seen = true
	if e.button_index == MOUSE_BUTTON_WHEEL_UP or e.button_index == MOUSE_BUTTON_WHEEL_DOWN:
		zoom_step(1 if e.button_index == MOUSE_BUTTON_WHEEL_UP else -1, p)
		return
	if e.button_index == MOUSE_BUTTON_MIDDLE:
		_pan = true
		return
	if paused:
		return
	if e.button_index == MOUSE_BUTTON_RIGHT:
		if place != "" or attack_mode:
			place = ""
			attack_mode = false
			changed.emit()
			return
		command(p)
		return
	if e.button_index == MOUSE_BUTTON_LEFT:
		if place != "":
			_try_place(p)
			return
		if attack_mode:
			_attack_click(p)
			attack_mode = e.shift_pressed
			changed.emit()
			return
		_down = p


## the wheel, a pinch or the zoom buttons: one level in or out, keeping the point under `at`
func zoom_step(d: int, at: Vector2 = Vector2.INF) -> void:
	var lv := clampi(world.zoom_level + d, 0, World.LEVELS.size() - 1)
	if lv == world.zoom_level:
		return
	if at == Vector2.INF:
		at = view_rect().get_center()
	world.set_zoom_level(lv, at)
	Settings.set_value("view", "zoom", lv - base_zoom())


## the zoom level the screen starts at (prototype: one step up when the field is wider than 1500 px;
## one more on a phone at UI scale 3)
func base_zoom() -> int:
	return (1 if view_rect().size.x > 1500 else 0) + (1 if ui_scale >= 3 else 0)


func _try_place(p: Vector2) -> void:
	var t := place_tile(p)
	if game.place_ready(0, t.x, t.y):
		place = ""
		changed.emit()


func _attack_click(p: Vector2) -> void:
	var w := _tile_at(p)
	var hit := world.pick(_px(p))
	var units := _own_units()
	if hit and hit.owner != 0:
		game.command_attack(units, hit)
	else:
		game.command_move(units, w.x, w.y, true)
	world.overlay["move_mark"] = {"x": w.x, "y": w.y, "t": game.time, "attack": true}


func _own_units() -> Array:
	var out := []
	for s in sel:
		if not s.is_b and s.owner == 0:
			out.append(s)
	return out


func _left_up(p: Vector2, shift: bool) -> void:
	var box: Variant = world.overlay.get("box")
	world.overlay["box"] = null
	_down = null
	if box is Rect2:
		_box_select(box, shift)
		return
	_click(p, shift)


func _box_select(box: Rect2, shift: bool) -> void:
	var r := box.abs()
	var x0 := r.position.x
	var x1 := r.end.x
	var y0 := r.position.y
	var y1 := r.end.y
	var picked: Array[Ent] = []
	var z := world.zoom
	for u in game.ents:
		if u.is_b or u.dead or u.owner != 0 or u.carried_by != null or u.inside != null:
			continue
		var s := _screen_of(u.x, u.y, u.z)
		if s.x >= x0 and s.x <= x1 and s.y - 4 * z >= y0 and s.y - 4 * z <= y1:
			picked.append(u)
	if shift:
		var all: Array[Ent] = sel.duplicate()
		for u in picked:
			if not all.has(u):
				all.append(u)
		set_sel(all)
	else:
		set_sel(picked)


## a left click (or a tap that selects)
func _click(p: Vector2, shift: bool) -> void:
	var g := game
	var hit := world.pick(_px(p))
	if hit == null:
		# a house of ours: the soldiers inside
		var hg := world.pick_garrison(_px(p))
		if hg and hg.owner == 0 and not hg.occ.is_empty():
			if shift:
				var all: Array[Ent] = []
				for s in sel:
					if not s.is_b:
						all.append(s)
				for o in hg.occ:
					if not all.has(o):
						all.append(o)
				set_sel(all)
			else:
				set_sel(hg.occ.duplicate())
			return
		if not shift:
			set_sel([])
		return
	var now := _now()
	# a bunker clicked twice: its crew
	if hit.is_b and hit.owner == 0 and _last_click["id"] == hit.id and now - int(_last_click["t"]) < DOUBLE_MS:
		var bg := g.garrison_of(hit)
		if bg and not bg.occ.is_empty():
			set_sel(bg.occ.duplicate())
			return
	# double click: all of that kind in view
	if hit.owner == 0 and not hit.is_b and _last_click["id"] == hit.id and now - int(_last_click["t"]) < DOUBLE_MS:
		var same: Array[Ent] = []
		var v := view_rect()
		for u in g.ents:
			if u.dead or u.owner != 0 or u.key != hit.key or u.is_b:
				continue
			if v.has_point(_screen_of(u.x, u.y)):
				same.append(u)
		set_sel(same)
		return
	_last_click = {"t": now, "id": hit.id}
	if shift and hit.owner == 0 and not hit.is_b:
		if sel.has(hit):
			var rest: Array[Ent] = []
			for s in sel:
				if s != hit:
					rest.append(s)
			set_sel(rest)
		else:
			var add: Array[Ent] = []
			for s in sel:
				if not s.is_b and s.owner == 0:
					add.append(s)
			add.append(hit)
			set_sel(add)
	else:
		set_sel([hit])


func set_sel(list: Array) -> void:
	for s in sel:
		s.selected = false
	sel.clear()
	for e in list:
		if not e.dead:
			sel.append(e)
	for s in sel:
		s.selected = true
	changed.emit()


## the top corner tile of a building being placed under a screen point
func place_tile(p: Vector2) -> Vector2i:
	var def: Dictionary = game.bdefs[place]
	var w := _tile_at(p)
	return Vector2i(int(Rng.js_round(w.x - float(def["w"]) / 2.0)), int(Rng.js_round(w.y - float(def["h"]) / 2.0)))


func _ack() -> void:
	Sound.play("ack")


func _mark(x: float, y: float, attack: bool) -> void:
	world.overlay["move_mark"] = {"x": x, "y": y, "t": game.time, "attack": attack}


## what a right click means here
func command(p: Vector2) -> void:
	var g := game
	var mine: Array = []
	for e in sel:
		if not e.dead and e.owner == 0:
			mine.append(e)
	if mine.is_empty():
		return
	var w := _tile_at(p)
	var px := _px(p)
	var hit := world.pick(px)
	var units: Array = []
	var blds: Array = []
	for e in mine:
		if e.is_b:
			blds.append(e)
		else:
			units.append(e)
	if units.is_empty():
		# buildings: a rally point
		for b in blds:
			var pr: Variant = b.b.get("produces")
			if pr != null and pr != "build":
				b.rally = Vector2(w.x, w.y)
		_mark(w.x, w.y, false)
		return
	# engineers take over enemy buildings
	var eng: Array = units.filter(func(u: Ent) -> bool: return u.u.get("engineer", false))
	if hit and hit.is_b and hit.owner != 0 and not eng.is_empty():
		g.command_capture(eng, hit)
		var rest: Array = units.filter(func(u: Ent) -> bool: return not u.u.get("engineer", false))
		var can: Array = rest.filter(func(u: Ent) -> bool: return g.can_hit(u, hit) or u.jet)
		g.command_attack(can, hit)
		var walk: Array = rest.filter(func(u: Ent) -> bool: return not can.has(u))
		if not walk.is_empty():
			g.command_move(walk, hit.x, hit.y, false)
		_mark(hit.x, hit.y, false)
		_ack()
		return
	# soldiers into a house, or into one of our bunkers
	var hg: Game.Garrison = world.pick_garrison(px) if hit == null or (hit.is_b and hit.owner == 0) else null
	if hg:
		var inf: Array = units.filter(func(u: Ent) -> bool: return u.u.get("infantry", false) and not u.u.get("engineer", false))
		if not hg.occ.is_empty() and hg.owner != 0:
			# the enemy is in there: fire on the house
			var t: Ent = hg.occ[0]
			var can: Array = units.filter(func(u: Ent) -> bool: return g.can_hit(u, t) or u.jet)
			g.command_attack(can, t)
			_mark(hg.x, hg.y, true)
			_ack()
			return
		if not inf.is_empty() and g.can_enter(0, hg):
			g.command_garrison(inf, hg)
			var rest: Array = units.filter(func(u: Ent) -> bool: return not inf.has(u))
			if not rest.is_empty():
				g.command_move(rest, hg.x, hg.y + 1.5, false)
			_mark(hg.x, hg.y, false)
			_ack()
			return
		if not inf.is_empty() and hg.occ.size() >= hg.cap:
			g.msg("%s ist voll" % hg.name, "warn")
	# ground troops onto our landing ship
	if hit and hit.owner == 0 and hit.u.get("transport", 0):
		var troops: Array = units.filter(func(u: Ent) -> bool: return not u.air and not u.naval)
		if not troops.is_empty():
			g.command_board(troops, hit)
			_mark(hit.x, hit.y, false)
			_ack()
			return
	if hit and hit.owner != 0:
		var can: Array = units.filter(func(u: Ent) -> bool: return g.can_hit(u, hit) or u.jet)
		g.command_attack(can, hit)
		var rest: Array = units.filter(func(u: Ent) -> bool: return not can.has(u))
		if not rest.is_empty():
			g.command_move(rest, hit.x, hit.y, false)
		_mark(hit.x, hit.y, true)
		_ack()
		return
	var harv: Array = units.filter(func(u: Ent) -> bool: return u.u.get("harvester", false))
	var others: Array = units.filter(func(u: Ent) -> bool: return not u.u.get("harvester", false))
	if not harv.is_empty():
		var tx := floori(w.x)
		var ty := floori(w.y)
		var i := g.map.idx(tx, ty) if g.map.in_map(tx, ty) else -1
		if hit and hit.owner == 0 and hit.key == "ref":
			g.command_return(harv)
		elif i >= 0 and g.map.ter[i] == GameMap.ORE and g.map.ore[i] > 0:
			g.command_harvest(harv, i)
		else:
			others = units
	if not others.is_empty():
		g.command_move(others, w.x, w.y, false)
	_mark(w.x, w.y, false)
	_ack()


# ─────────────────────────────────────────────────────────────── keys

func _digit(k: Key) -> int:
	if k >= KEY_0 and k <= KEY_9:
		return k - KEY_0
	if k >= KEY_KP_0 and k <= KEY_KP_9:
		return k - KEY_KP_0
	return -1


## a key went down; true if it was used
func _key(e: InputEventKey) -> bool:
	var k := e.keycode
	var g := game
	if k == KEY_P or k == KEY_F10 or k == KEY_BACK:
		pause_requested.emit()
		return true
	if paused:
		return false
	if not e.ctrl_pressed and not e.meta_pressed and not e.alt_pressed and hud and hud.has_method("hotkey") and hud.hotkey(e):
		return true
	if k == KEY_ESCAPE:
		if place != "" or attack_mode:
			place = ""
			attack_mode = false
		else:
			set_sel([])
		changed.emit()
		return true
	var n := _digit(k)
	if n >= 0:
		if e.ctrl_pressed or e.meta_pressed:
			var ids := []
			for s in sel:
				if s.owner == 0:
					ids.append(s.id)
			groups[n] = ids
			g.msg("Gruppe %d gebildet" % n)
			return true
		if not groups.has(n):
			return true
		var list: Array[Ent] = []
		for id in groups[n]:
			var x: Ent = g.by_id.get(id)
			if x and not x.dead and x.carried_by == null:
				list.append(x)
		set_sel(list)
		var now := _now()
		if _last_group["n"] == n and now - int(_last_group["t"]) < GROUP_MS and not list.is_empty():
			look_at(list[0].x, list[0].y)
		_last_group = {"n": n, "t": now}
		return true
	match k:
		KEY_A:
			for s in sel:
				if not s.is_b and s.owner == 0 and s.weapon != null:
					attack_mode = true
					changed.emit()
					break
		KEY_S:
			g.command_stop(sel.filter(func(s: Ent) -> bool: return s.owner == 0))
		KEY_D:
			unload_or_exit()
		KEY_H:
			go_home()
		KEY_SPACE:
			if not sel.is_empty():
				look_at(sel[0].x, sel[0].y)
		KEY_E:
			# everything that fights, in view
			var v := view_rect()
			var army: Array[Ent] = []
			for u in g.ents:
				if u.dead or u.owner != 0 or u.is_b or u.weapon == null:
					continue
				if v.has_point(_screen_of(u.x, u.y)):
					army.append(u)
			set_sel(army)
		KEY_Q:
			var army: Array[Ent] = []
			for u in g.ents:
				if not u.dead and u.owner == 0 and not u.is_b and u.weapon != null:
					army.append(u)
			set_sel(army)
		_:
			return false
	return true


## D: transports unload, soldiers leave their houses, bunkers empty
func unload_or_exit() -> void:
	var g := game
	for t in sel:
		if t.owner == 0 and not t.is_b and t.u.get("transport", 0):
			g.command_unload(t)
	var out: Array = []
	for t in sel:
		if t.owner == 0 and t.inside != null:
			out.append(t)
	for b in sel:
		var hg: Game.Garrison = g.garrison_of(b) if b.is_b and b.owner == 0 else null
		if hg:
			out.append_array(hg.occ)
	if not out.is_empty():
		g.command_exit(out)
		changed.emit()


## H: to the headquarters (or any building of ours)
func go_home() -> void:
	var hq: Ent = null
	for e in game.ents:
		if e.owner == 0 and e.key == "hq":
			hq = e
			break
	if hq == null:
		for e in game.ents:
			if e.owner == 0 and e.is_b:
				hq = e
				break
	if hq:
		look_at(hq.x, hq.y)


# ─────────────────────────────────────────────────────────────── touch

func _dist2() -> Array:
	var ps: Array = _touches.values()
	return [ps[0].distance_to(ps[1]), (ps[0] + ps[1]) / 2.0]


func _touch_down(i: int, p: Vector2) -> void:
	_touches[i] = p
	if _touches.size() == 1:
		_t_mode = "tap"
		_t_start = p
		_t_time = _now()
		_t_long = false
	elif _touches.size() == 2:
		world.overlay["box"] = null
		_t_mode = "pinch"
		var d := _dist2()
		_pinch_d = maxf(1.0, d[0])
		_pinch_mid = d[1]


func _touch_drag(i: int, p: Vector2) -> void:
	var prev: Vector2 = _touches[i]
	_touches[i] = p
	if _t_mode == "pinch":
		if _touches.size() < 2:
			return
		var d := _dist2()
		var mid: Vector2 = d[1]
		world.pan_screen(-(mid - _pinch_mid))
		_pinch_mid = mid
		var r: float = d[0] / _pinch_d
		if r > 1.3 or r < 1.0 / 1.3:
			zoom_step(1 if r > 1.0 else -1, mid)
			_pinch_d = maxf(1.0, d[0])
		return
	if _t_mode == "tap" and p.distance_to(_t_start) > 6.0 * ui_scale:
		_t_mode = "box" if box_mode and not paused else "pan"
		if _t_mode == "pan":
			prev = _t_start
	if _t_mode == "pan":
		world.pan_screen(-(p - prev))
	elif _t_mode == "box":
		world.overlay["box"] = Rect2(_t_start, p - _t_start)


func _touch_up(i: int, p: Vector2, canceled := false) -> void:
	_touches.erase(i)
	var mode := _t_mode
	if not _touches.is_empty():
		return
	_t_mode = ""
	if canceled:
		world.overlay["box"] = null
		return
	if mode == "box":
		var box: Variant = world.overlay.get("box")
		world.overlay["box"] = null
		if box is Rect2:
			_box_select(box, false)
	elif mode == "tap" and not _t_long:
		tap(p)


## a tap on the field: select, or with a selection of ours, command like a right click
func tap(p: Vector2) -> void:
	if paused:
		return
	if place != "":
		_try_place(p)
		return
	if attack_mode:
		_attack_click(p)
		attack_mode = false
		changed.emit()
		return
	if _tap_commands(p):
		command(p)
	else:
		_click(p, false)


## does a tap here give an order (rather than select)?
func _tap_commands(p: Vector2) -> bool:
	var own := false
	for s in sel:
		if not s.dead and s.owner == 0:
			own = true
	if not own:
		return false
	var units := _own_units()
	var px := _px(p)
	var hit := world.pick(px)
	if hit and hit.owner == 0:
		if units.is_empty():
			return false
		if hit.u.get("transport", 0) and units.any(func(u: Ent) -> bool: return u != hit and not u.air and not u.naval):
			return true
		if hit.key == "ref" and units.any(func(u: Ent) -> bool: return u.u.get("harvester", false)):
			return true
		if hit.is_b and hit.key == "bunker":
			var bg := game.garrison_of(hit)
			if bg and game.can_enter(0, bg) and units.any(func(u: Ent) -> bool: return u.u.get("infantry", false) and not u.u.get("engineer", false)):
				return true
		return false
	if hit == null:
		var hg := world.pick_garrison(px)
		if hg and hg.owner == 0 and not hg.occ.is_empty():
			var inf := units.any(func(u: Ent) -> bool: return u.u.get("infantry", false) and not u.u.get("engineer", false))
			return inf and game.can_enter(0, hg)
	return true


## a long press: attack-move there (with fighting units selected)
func long_press(p: Vector2) -> void:
	if paused or place != "":
		return
	var units := _own_units()
	if not units.any(func(u: Ent) -> bool: return u.weapon != null):
		return
	_attack_click(p)
	_ack()


# ─────────────────────────────────────────────────────────────── every frame

func _process(dt: float) -> void:
	if not world or not game:
		return
	if not paused:
		scroll(minf(0.1, dt))
	if _t_mode == "tap" and not _t_long and _touches.size() == 1 and _now() - _t_time > LONG_MS:
		_t_long = true
		long_press(_t_start)
	frame()


## move the view with keys and screen edges
func scroll(dt: float) -> void:
	var sp := 1040.0 * dt  # screen pixels (the prototype: 1040 / scale picture pixels)
	var d := Vector2.ZERO
	if _keys.has(KEY_LEFT): d.x -= sp
	if _keys.has(KEY_RIGHT): d.x += sp
	if _keys.has(KEY_UP): d.y -= sp
	if _keys.has(KEY_DOWN): d.y += sp
	if mouse_inside and _down == null and not _pan and _focus and _touches.is_empty():
		var m := 8.0 * world.zoom
		var v := view_rect()
		if mouse.x <= m: d.x -= sp
		if mouse.x >= v.size.x - m - 1: d.x += sp
		if mouse.y <= m: d.y -= sp
		if mouse.y >= v.size.y - m - 1: d.y += sp
	if d != Vector2.ZERO:
		world.pan_screen(d)


## hover feedback, the building ghost and the cursor
func frame() -> void:
	var g := game
	for s in sel:
		if s.dead or s.carried_by != null:
			set_sel(sel.filter(func(x: Ent) -> bool: return not x.dead and x.carried_by == null))
			break
	var p := mouse
	var hovered := get_viewport().gui_get_hovered_control()
	mouse_inside = _mouse_seen and _in_window and view_rect().has_point(p) and (hovered == null or _down != null)
	var o := world.overlay
	var px := _px(p)
	o["hover_ent"] = world.pick(px) if mouse_inside and o.get("box") == null else null
	var hb: Ent = o["hover_ent"]
	o["hover_g"] = world.pick_garrison(px) if mouse_inside and o.get("box") == null and (hb == null or (hb.is_b and hb.owner == 0 and hb.key == "bunker")) else null
	if place != "":
		# touch: the ghost follows the last finger (or stays in the middle of the view)
		var at := p if _mouse_seen else (_t_start if _t_start != Vector2.ZERO else view_rect().get_center())
		var t := place_tile(at)
		o["place"] = {"key": place, "tx": t.x, "ty": t.y, "ok": g.can_place(0, place, t.x, t.y)}
	else:
		o["place"] = null
	_set_cursor(_cursor_for(p) if mouse_inside else "pointer")


## the cursor says what a click will do
func _cursor_for(p: Vector2) -> String:
	var g := game
	var o := world.overlay
	var h: Ent = o.get("hover_ent")
	var hg: Game.Garrison = o.get("hover_g")
	var mine := sel.any(func(s: Ent) -> bool: return not s.is_b and s.owner == 0)
	if place != "":
		return "place"
	if attack_mode:
		return "attack"
	if h and h.is_b and h.owner != 0 and sel.any(func(s: Ent) -> bool: return not s.is_b and s.u.get("engineer", false)):
		return "capture"
	if h and h.owner != 0 and mine:
		return "attack"
	if hg and not hg.occ.is_empty() and hg.owner != 0 and mine:
		return "attack"
	if hg and sel.any(func(s: Ent) -> bool: return not s.is_b and s.u.get("infantry", false) and not s.u.get("engineer", false)) and g.can_enter(0, hg):
		return "enter"
	if h and h.owner == 0 and not h.is_b and h.u.get("transport", 0) and sel.any(func(s: Ent) -> bool: return not s.is_b and not s.naval and not s.air):
		return "enter"
	if h:
		return "select"
	if mine:
		var w := _tile_at(p)
		var tx := floori(w.x)
		var ty := floori(w.y)
		if sel.any(func(s: Ent) -> bool: return not s.is_b and s.u.get("harvester", false)) and g.map.in_map(tx, ty) and g.map.ore[g.map.idx(tx, ty)] > 0:
			return "capture"
		return "move" if g.map.walk(tx, ty) else "forbidden"
	return "pointer"


func _set_cursor(name: String) -> void:
	var shape: int = UiTheme.CURSORS.get(name, Input.CURSOR_ARROW)
	if shape != _cursor:
		_cursor = shape
		Input.set_default_cursor_shape(shape as Input.CursorShape)


## the cursor shown now (tests)
func cursor_name() -> String:
	for n: String in UiTheme.CURSORS:
		if UiTheme.CURSORS[n] == _cursor:
			return n
	return "pointer"
