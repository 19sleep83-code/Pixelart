extends Node
## scripts/battle.gd as main.gd starts it, with a few fake inputs:
##   xvfb-run -a -s "-screen 0 1600x900x24" godot --path godot --rendering-driver opengl3 \
##     res://tests/runner.tscn -- view_battle [out dir]


func run(args: PackedStringArray) -> void:
	var out: String = args[0] if args.size() > 0 else ""
	var b: Node = load("res://scripts/battle.gd").new()
	b.set("opts", {"seed": 777, "faction": "ru", "difficulty": 1, "mapType": "coast", "tod": "dusk", "weather": "clouds"})
	var done := [false]
	b.connect("finished", func(): done[0] = true)
	add_child(b)
	var world: World = b.get("world")
	var game: Game = b.get("game")
	var t0 := Time.get_ticks_msec()
	for i in 120:
		await get_tree().process_frame
	print("120 frames in %d ms, game time %.1f s, zoom %.1f, view %s" % [Time.get_ticks_msec() - t0, game.time, world.zoom, world._view])
	# click on our harvester (or anything of ours), then send it somewhere
	var mine: Ent = null
	for e in game.ents:
		if e.owner == 0 and not e.is_b:
			mine = e
			break
	if mine:
		world.look_at_tile(mine.x, mine.y)
		await get_tree().process_frame
		var sp := world.px_to_screen(world.tile_to_px(mine.x, mine.y, mine.z) + Vector2(0, -10))
		var hit := world.pick(world.screen_to_px(sp))
		print("pick at the unit: ", hit.key if hit else "nichts", " (", mine.key, ")")
		_click(sp, MOUSE_BUTTON_LEFT)
		await get_tree().process_frame
		print("selected: ", mine.selected)
		_click(sp + Vector2(200, 80), MOUSE_BUTTON_RIGHT)
		await get_tree().process_frame
		print("move mark: ", world.overlay["move_mark"], "  order: ", mine.order)
	_click(Vector2(800, 450), MOUSE_BUTTON_WHEEL_UP)
	await get_tree().process_frame
	print("zoom after wheel: ", world.zoom)
	for i in 30:
		await get_tree().process_frame
	if out != "":
		await RenderingServer.frame_post_draw
		get_viewport().get_texture().get_image().save_png(out.path_join("battle_view.png"))
	var ev := InputEventKey.new()
	ev.keycode = KEY_ESCAPE
	ev.pressed = true
	Input.parse_input_event(ev)
	for i in 5:
		await get_tree().process_frame
	print("finished emitted: ", done[0])
	b.queue_free()
	await get_tree().process_frame


func _click(p: Vector2, button: MouseButton) -> void:
	var ev := InputEventMouseButton.new()
	ev.position = p
	ev.global_position = p
	ev.button_index = button
	ev.pressed = true
	Input.parse_input_event(ev)
	var up := ev.duplicate()
	up.pressed = false
	Input.parse_input_event(up)
