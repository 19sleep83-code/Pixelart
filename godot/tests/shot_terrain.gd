extends SceneTree
## xvfb-run -a godot --path godot --rendering-driver opengl3 -s tests/shot_terrain.gd -- <seed> <type> <out.png>

var _frame := 0
var _cam: Camera2D
var _out := "terrain.png"


func _process(_delta: float) -> bool:
	_frame += 1
	if _frame == 1:
		var args := OS.get_cmdline_user_args()
		var seed := int(args[0]) if args.size() > 0 else 777
		var type: String = args[1] if args.size() > 1 else "coast"
		_out = args[2] if args.size() > 2 else "terrain.png"
		var t0 := Time.get_ticks_msec()
		var m := GameMap.generate(seed, type)
		var t1 := Time.get_ticks_msec()
		var ter := Terrain.new()
		root.add_child(ter)
		ter.setup(m)
		print("generate %d ms, tiles %d ms" % [t1 - t0, Time.get_ticks_msec() - t1])
		_cam = Camera2D.new()
		root.add_child(_cam)
		var s: Vector2i = m.starts[0]
		_cam.position = Vector2((s.x - s.y) * 32.0, (s.x + s.y) * 16.0)
		_cam.zoom = Vector2(0.5, 0.5)
		_cam.make_current()
	if _frame == 6:
		root.get_viewport().get_texture().get_image().save_png(_out)
		print("saved ", _out)
		return true
	return false
