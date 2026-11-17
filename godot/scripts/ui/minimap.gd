class_name MiniMap
extends Control
## The situation map of the sidebar (hud.ts drawMini, terrain.ts miniMap): the ground in its colours
## with woods and villages, units and buildings as dots, the fog, a map sheet's grid with letters and
## numbers, and the frame of the view. A click or drag moves the view there; a right click sends the
## selection.

const W := 256
const H := 128
const OUTSIDE := Color("141a12")

var game: Game
var world: World
var input: PlayerInput
var k := 2
var _ground: ImageTexture
var _fog: Control
var _top: Control
var _drag := false


func setup(g: Game, w: World, inp: PlayerInput, scale_k: int) -> void:
	game = g
	world = w
	input = inp
	k = scale_k
	mouse_filter = Control.MOUSE_FILTER_STOP
	mouse_default_cursor_shape = Control.CURSOR_CROSS
	clip_contents = true
	_ground = ImageTexture.create_from_image(_paint())
	# the fog above the dots, coloured by the world's fog shader
	_fog = Control.new()
	_fog.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_fog.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var sh := Shader.new()
	sh.code = World.FOG_SHADER
	var mat := ShaderMaterial.new()
	mat.shader = sh
	mat.set_shader_parameter("fog", world.fog_texture())
	_fog.material = mat
	_fog.draw.connect(_draw_fog)
	add_child(_fog)
	_top = Control.new()
	_top.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_top.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_top.draw.connect(_draw_top)
	add_child(_top)


## the colour of each kind of ground tile: the middle of its picture in the terrain atlas, averaged
func _paint() -> Image:
	var m := game.map
	var N := m.N
	var t: Dictionary = Data.manifest.get("terrain", {})
	var atlas := Data.tex(t.get("atlas", ""))
	var src: Image = atlas.get_image() if atlas else null
	var cols := 1
	var rows := 1
	var small: Image = null
	if src:
		src = src.duplicate()
		if src.is_compressed():
			src.decompress()
		src.convert(Image.FORMAT_RGBA8)
		cols = maxi(1, src.get_width() / Data.TW)
		rows = maxi(1, src.get_height() / Data.TH)
		# one pixel per 8 × 8 of the atlas (averaged through the mipmaps)
		src.generate_mipmaps()
		small = src.duplicate()
		small.resize(cols * 8, rows * 4, Image.INTERPOLATE_TRILINEAR)
	var tiles := PackedColorArray()
	tiles.resize(N * N)
	var cache := {}
	var terr := Terrain.new()
	terr.map = m
	for info in t.get("tiles", []):
		terr._coords[info["key"]] = Vector2i(int(info["col"]), int(info["row"]))
	for ty in N:
		for tx in N:
			var i := ty * N + tx
			var key := terr.tile_key(tx, ty)
			if m.ter[i] == GameMap.ROAD:
				key = "road/r%d/v0" % m.road[i]
			var c: Color
			if cache.has(key):
				c = cache[key]
			else:
				c = Color("4a7a30")
				var at: Vector2i = terr._coords.get(key, Vector2i(-1, -1))
				if small and at.x >= 0:
					var x0 := at.x * 8
					var y0 := at.y * 4
					c = (small.get_pixel(x0 + 3, y0 + 1) + small.get_pixel(x0 + 4, y0 + 1) + small.get_pixel(x0 + 3, y0 + 2) + small.get_pixel(x0 + 4, y0 + 2)) / 4.0
					c.a = 1.0
				cache[key] = c
			tiles[i] = c
	terr.free()
	var img := Image.create(W, H, false, Image.FORMAT_RGBA8)
	img.fill(OUTSIDE)
	var kx := float(W) / (N * 64.0)
	var ky := float(H) / (N * 32.0)
	var ox := N * 32.0
	for py in H:
		for px in W:
			var sx := (px + 0.5) / kx - ox
			var sy := (py + 0.5) / ky
			var a := sx / 32.0
			var b := sy / 16.0
			var wx := floori((a + b) / 2.0)
			var wy := floori((b - a) / 2.0)
			if wx >= 0 and wy >= 0 and wx < N and wy < N:
				img.set_pixel(px, py, tiles[wy * N + wx])
	# the woods read better as dark patches, the villages as red roofs
	var tree := Color("2c4a26")
	var roof := Color("a9452e")
	for s in m.statics:
		var x := ((float(s["x"]) - float(s["y"])) * 32.0 + ox) * kx
		var y := (float(s["x"]) + float(s["y"])) * 16.0 * ky
		var kd: String = s["kind"]
		var is_tree := kd == "oak" or kd == "pine" or kd == "birch"
		var ix := floori(x)
		var iy := floori(y)
		if ix >= 0 and iy >= 0 and ix < W and iy < H:
			img.set_pixel(ix, iy, tree if is_tree else roof)
			if not is_tree and ix + 1 < W and iy + 1 < H:
				img.set_pixel(ix + 1, iy, roof)
				img.set_pixel(ix, iy + 1, roof)
				img.set_pixel(ix + 1, iy + 1, roof)
	return img


## world pixels → this control
func _to_local(p: Vector2) -> Vector2:
	var N := game.map.N
	return Vector2((p.x + N * 32.0) * size.x / (N * 64.0), p.y * size.y / (N * 32.0))


## this control → world tiles
func _to_tile(p: Vector2) -> Vector2:
	var N := game.map.N
	var sx := p.x / size.x * N * 64.0 - N * 32.0
	var sy := p.y / size.y * N * 32.0
	return Vector2((sx / 32.0 + sy / 16.0) / 2.0, (sy / 16.0 - sx / 32.0) / 2.0)


func _draw() -> void:
	if not game:
		return
	draw_rect(Rect2(Vector2.ZERO, size), Color("0b0d09"))
	draw_texture_rect(_ground, Rect2(Vector2.ZERO, size), false)
	var sel_c := Color("ffffff")
	var own_c := Color("7dff6a")
	var foe_c := Color("ff4a3a")
	var f := size.x / W
	for e in game.ents:
		if e.dead or not world.shown(e):
			continue
		var p := _to_local(world.tile_to_px(e.x, e.y))
		var own := e.owner == 0
		var c := (sel_c if e.selected else own_c) if own else foe_c
		var s := (maxf(2.0, e.w * 1.6) if e.is_b else (3.0 if e.naval else 2.0)) * f
		draw_rect(Rect2(roundf(p.x - s / 2.0), roundf(p.y - s / 4.0), ceilf(s), maxf(f, ceilf(s / 2.0))), c)


func _draw_fog() -> void:
	var N := game.map.N
	var kx := size.x / (N * 64.0)
	var ky := size.y / (N * 32.0)
	_fog.draw_set_transform_matrix(Transform2D(Vector2(32 * kx, 16 * ky), Vector2(-32 * kx, 16 * ky), Vector2(N * 32.0 * kx, 0)))
	_fog.draw_texture_rect(world.fog_texture(), Rect2(0, 0, N, N), false)


func _draw_top() -> void:
	# a map sheet's grid with letters and numbers
	var line := Color(216 / 255.0, 191 / 255.0, 92 / 255.0, 0.18)
	var txt := Color(216 / 255.0, 191 / 255.0, 92 / 255.0, 0.6)
	var font := ThemeDB.fallback_font
	var fs := UiTheme.px(8, k)
	for i in range(1, 8):
		var x := roundf(i * size.x / 8.0) + 0.5
		_top.draw_line(Vector2(x, 0), Vector2(x, size.y), line, 1.0)
	for j in range(1, 4):
		var y := roundf(j * size.y / 4.0) + 0.5
		_top.draw_line(Vector2(0, y), Vector2(size.x, y), line, 1.0)
	for i in 8:
		_top.draw_string(font, Vector2(i * size.x / 8.0 + 2 * k / 2.0, fs), "ABCDEFGH"[i], HORIZONTAL_ALIGNMENT_LEFT, -1, fs, txt)
	for j in 4:
		_top.draw_string(font, Vector2(2 * k / 2.0, j * size.y / 4.0 + fs * 2), str(j + 1), HORIZONTAL_ALIGNMENT_LEFT, -1, fs, txt)
	# the view (the part of the screen left of the sidebar)
	var v := input.view_rect()
	var a := _to_local(world.screen_to_px(v.position))
	var b := _to_local(world.screen_to_px(v.end))
	_top.draw_rect(Rect2(a.round(), (b - a).round()), Color("f2e6a8"), false, maxf(1.0, k / 2.0))


func refresh() -> void:
	queue_redraw()
	_fog.queue_redraw()
	_top.queue_redraw()


func _go(p: Vector2, command: bool) -> void:
	var w := _to_tile(p)
	if command:
		var units: Array = []
		for u in input.sel:
			if not u.is_b and u.owner == 0:
				units.append(u)
		if not units.is_empty():
			game.command_move(units, w.x, w.y, false)
		return
	input.look_at(w.x, w.y)
	refresh()


func _gui_input(ev: InputEvent) -> void:
	if ev is InputEventMouseButton:
		var mb := ev as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_LEFT:
			_drag = mb.pressed
			if mb.pressed:
				_go(mb.position, false)
			accept_event()
		elif mb.button_index == MOUSE_BUTTON_RIGHT and mb.pressed:
			_go(mb.position, true)
			accept_event()
	elif ev is InputEventMouseMotion:
		if _drag and (ev as InputEventMouseMotion).button_mask & MOUSE_BUTTON_MASK_LEFT:
			_go(ev.position, false)
			accept_event()
		elif _drag:
			_drag = false
	elif ev is InputEventScreenTouch:
		if ev.pressed:
			_go(ev.position, false)
		accept_event()
	elif ev is InputEventScreenDrag:
		_go(ev.position, false)
		accept_event()
