class_name DebugInput
extends Node
## Bare controls for trying the world out (the real input and interface come later):
## left click selects (one unit, or none), right click moves or attacks, the wheel zooms at the
## cursor, the middle button drags the view, the arrow keys scroll, P pauses, Esc leaves.

var world: World
var game: Game
var battle: Node
var _drag := false


func _selected() -> Array:
	var out := []
	for e in game.ents:
		if e.selected and not e.dead and not e.is_b and e.owner == 0:
			out.append(e)
	return out


func _unhandled_input(ev: InputEvent) -> void:
	if ev is InputEventMouseButton:
		var mb := ev as InputEventMouseButton
		var px := world.screen_to_px(mb.position)
		if mb.button_index == MOUSE_BUTTON_WHEEL_UP and mb.pressed:
			world.set_zoom_level(world.zoom_level + 1, mb.position)
		elif mb.button_index == MOUSE_BUTTON_WHEEL_DOWN and mb.pressed:
			world.set_zoom_level(world.zoom_level - 1, mb.position)
		elif mb.button_index == MOUSE_BUTTON_MIDDLE:
			_drag = mb.pressed
		elif mb.button_index == MOUSE_BUTTON_LEFT and mb.pressed:
			var hit := world.pick(px)
			for e in game.ents:
				e.selected = false
			if hit and hit.owner == 0:
				hit.selected = true
		elif mb.button_index == MOUSE_BUTTON_RIGHT and mb.pressed:
			var sel := _selected()
			if sel.is_empty():
				return
			var hit := world.pick(px)
			var t := world.px_to_tile(px)
			if hit and hit.owner != 0:
				game.command_attack(sel, hit)
				world.overlay["move_mark"] = {"x": hit.x, "y": hit.y, "t": game.time, "attack": true}
			else:
				game.command_move(sel, t.x, t.y, false)
				world.overlay["move_mark"] = {"x": t.x, "y": t.y, "t": game.time, "attack": false}
	elif ev is InputEventMouseMotion:
		var mm := ev as InputEventMouseMotion
		if _drag:
			world.pan_screen(-mm.relative)
		var px := world.screen_to_px(mm.position)
		world.overlay["hover_ent"] = world.pick(px)
		world.overlay["hover_g"] = world.pick_garrison(px)
	elif ev is InputEventKey and ev.pressed and not ev.echo:
		if ev.keycode == KEY_ESCAPE and battle and battle.has_method("quit"):
			battle.quit()
		elif ev.keycode == KEY_P and battle:
			battle.paused = not battle.paused


func _process(dt: float) -> void:
	var d := Vector2.ZERO
	if Input.is_key_pressed(KEY_LEFT): d.x -= 1
	if Input.is_key_pressed(KEY_RIGHT): d.x += 1
	if Input.is_key_pressed(KEY_UP): d.y -= 1
	if Input.is_key_pressed(KEY_DOWN): d.y += 1
	if d != Vector2.ZERO:
		world.pan_screen(d * 900.0 * dt)
