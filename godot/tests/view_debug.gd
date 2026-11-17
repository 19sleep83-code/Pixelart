extends Node
## debugging helper: shot of the sea scene with parts of the world hidden
##   … runner.tscn -- view_debug <out.png> <hide: water|dyn|terrain>…

func run(args: PackedStringArray) -> void:
	var sb: Node = load("res://tests/shot_battle.gd").new()
	add_child(sb)
	sb.out_dir = args[0]
	var g := Game.new({"seed": 4242, "faction": "nato", "difficulty": 1, "mapType": "coast", "tod": "day", "weather": "clear"})
	var w := World.new()
	add_child(w)
	w.setup(g)
	g.reveal = true
	g.update_fog()
	w.set_zoom_level(1)
	w.look_at_tile(30, 70)
	for a in args.slice(1):
		if a == "water":
			for n in w.atmos.water_nodes: n.visible = false
		if a == "dyn":
			w._holder.visible = false
	for i in 3:
		await get_tree().process_frame
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(args[0] + "/dbg.png")
