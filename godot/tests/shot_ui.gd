extends Node
## Screenshots of the whole screen with the interface: menu, battle start, a busy battle with the
## selection panel and a data card, the pause menu, the end screen.
##   xvfb-run -a -s "-screen 0 1600x900x24" godot --path godot --rendering-driver opengl3 \
##     --resolution 1600x900 res://tests/runner.tscn -- shot_ui desktop [out dir]
##   xvfb-run -a -s "-screen 0 2400x1080x24" godot … --resolution 2400x1080 … -- shot_ui phone [out dir]
## "phone" forces UI scale 3 and the touch buttons.

const STEP := 1.0 / 30.0


func run(args: PackedStringArray) -> void:
	var mode: String = args[0] if args.size() > 0 else "desktop"
	var out: String = args[1] if args.size() > 1 else "/tmp/claude-0/-home-user-Pixelart/3bb0c800-0ee2-564d-80a3-1ee820e0ddef/scratchpad/godot_shots"
	DirAccess.make_dir_recursive_absolute(out)
	if mode == "phone":
		UiTheme.force_scale = 3
		UiTheme.force_touch = 1
	else:
		UiTheme.force_scale = 2
		UiTheme.force_touch = 0
	Settings.set_value("view", "zoom", 0)
	await _frames(2)
	print("window ", get_viewport().get_visible_rect().size)
	var main: Node = load("res://scripts/main.gd").new()
	add_child(main)
	await _frames(10)
	await _shot(out, "ui_%s_menu" % mode)
	# start a battle on the coast with a fixed map
	var menu: Menu = main.get("menu")
	menu.opts.merge({"faction": "nato", "difficulty": 1, "mapType": "coast", "tod": "day", "weather": "clouds"}, true)
	menu._seed_edit.text = "4242"
	menu._go()
	await _frames(20)
	var b: Node = main.get("battle")
	var g: Game = b.get("game")
	var inp: PlayerInput = b.get("input")
	var hud: Hud = b.get("hud")
	await _shot(out, "ui_%s_start" % mode)
	# a busy battle: both sides played by the computer for a while
	var mine := AI.new(g)
	mine.p = 0
	var t0 := Time.get_ticks_msec()
	for i in 30 * 200:
		g.update(STEP)
		b.get("ai").update(STEP)
		mine.update(STEP)
		if g.over != 0:
			break
	print("fast-forward %.0f s in %d ms" % [g.time, Time.get_ticks_msec() - t0])
	# look at our biggest group, select a few
	var army: Array[Ent] = []
	for e in g.ents:
		if e.owner == 0 and not e.is_b and e.weapon != null and e.inside == null and e.carried_by == null:
			army.append(e)
	if not army.is_empty():
		inp.look_at(army[0].x, army[0].y)
		var near: Array[Ent] = []
		for e in army:
			if absf(e.x - army[0].x) + absf(e.y - army[0].y) < 8:
				near.append(e)
		inp.set_sel(near)
	hud.set_tab("veh")
	await _frames(5)
	# hover an item: its data card
	var item: Control = hud.control("Item_mbt")
	if item:
		_motion(item.get_global_rect().get_center())
	await _frames(6)
	print("card shown: ", hud.card_visible(), "  selected: ", inp.sel.size())
	await _shot(out, "ui_%s_busy" % mode)
	# one unit selected (portrait, rank, hp, extra)
	if not army.is_empty():
		inp.set_sel([army[0]])
	_motion(Vector2(200, 300))
	await _frames(5)
	await _shot(out, "ui_%s_one" % mode)
	b.call("set_paused", true)
	await _frames(5)
	await _shot(out, "ui_%s_pause" % mode)
	b.call("set_paused", false)
	g.over = 1
	b.call("show_end")
	await _frames(5)
	await _shot(out, "ui_%s_end" % mode)
	b.call("quit")
	await _frames(5)
	print("back in the menu: ", main.get("menu") != null)
	main.queue_free()
	await _frames(2)


func _frames(n: int) -> void:
	for i in n:
		await get_tree().process_frame


func _motion(p: Vector2) -> void:
	var ev := InputEventMouseMotion.new()
	ev.position = p
	ev.global_position = p
	Input.parse_input_event(ev)


func _shot(out: String, name_: String) -> void:
	await RenderingServer.frame_post_draw
	var path := out.path_join(name_ + ".png")
	get_viewport().get_texture().get_image().save_png(path)
	print("saved ", path)
