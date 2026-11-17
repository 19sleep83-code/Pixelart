extends Node
## godot --path godot --rendering-driver opengl3 res://tests/runner.tscn -- shot_terrain <seed> <type> <out.png>


func run(args: PackedStringArray) -> void:
	var seed := int(args[0]) if args.size() > 0 else 777
	var type: String = args[1] if args.size() > 1 else "coast"
	var out: String = args[2] if args.size() > 2 else "terrain.png"
	var t0 := Time.get_ticks_msec()
	var m := GameMap.generate(seed, type)
	var t1 := Time.get_ticks_msec()
	var ter := Terrain.new()
	add_child(ter)
	ter.setup(m)
	print("generate %d ms, tiles %d ms" % [t1 - t0, Time.get_ticks_msec() - t1])
	var cam := Camera2D.new()
	add_child(cam)
	var s: Vector2i = m.starts[0]
	cam.position = Vector2((s.x - s.y) * 32.0, (s.x + s.y) * 16.0)
	cam.zoom = Vector2.ONE * (float(args[3]) if args.size() > 3 else 1.0)
	cam.make_current()
	for i in 5:
		await get_tree().process_frame
	get_viewport().get_texture().get_image().save_png(out)
	print("saved ", out)
