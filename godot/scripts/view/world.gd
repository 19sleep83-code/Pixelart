class_name World
extends Node2D
## The battlefield as the player sees it (port of src/game/render.ts with atmos.ts and the marks
## of terrain.ts). Everything is in world pixels (the prototype's fine pixels: a tile is 64 × 32,
## one unit of height 2.5 px); the camera scales the picture by the zoom level.
##
## Order, as in the prototype: ground (tiles, the shadows of trees and houses, scorch marks and
## rubble) → water glints and surf → shadows → markers on the ground → everything that stands,
## sorted back to front → aircraft → cloud shadows → building brackets → smoke, dust and water →
## the colour of the hour → lights → shells and rockets → fire and explosions → rain → health bars
## and flags → fog → the player's cursor work (`overlay`).
##
## Each layer is one canvas item filled through the RenderingServer every frame, with only what is
## in view.
##
## Like the prototype (a small canvas scaled up by the page with hard pixels), the world is drawn
## at one screen pixel per world pixel into a SubViewport of the window's size divided by the zoom,
## and that picture is shown scaled up with nearest filtering on a CanvasLayer below the interface.
## So `camera` (inside that SubViewport) always has zoom 1; the zoom is `zoom` / `zoom_level`.

const LEVELS := [1.0, 1.5, 2.0, 3.0]
const P := 2.0
const KZ := 2.5

const C_SEL := Color("#7dff6a")
const C_HOVER := Color("#d8ffd0")
const C_FOE := Color("#ff5a4a")
const C_BAR_BG := Color("#0c0e0a")
const C_GOLD := Color("#e0b532")

var game: Game
var terrain: Terrain
var atmos: Atmos
## the camera of the world's picture (its position is the centre of the view in world pixels;
## its zoom stays 1, use set_zoom_level)
var camera: Camera2D
var zoom_level := 0
## screen pixels per world pixel
var zoom: float:
	get:
		return LEVELS[zoom_level]
## what the input shows on the field: box (Rect2, screen pixels), place ({key, tx, ty, ok}),
## hover_ent (Ent), hover_g (Game.Garrison), move_mark ({x, y, t, attack})
var overlay := {"box": null, "place": null, "hover_ent": null, "hover_g": null, "move_mark": null}
## draws every frame by itself; tests may turn this off and call redraw()
var auto_draw := true
## the game stands still (no rain falling, no fog of time)
var paused := false
## time the last redraw took (ms)
var draw_ms := 0.0
## set to a Dictionary to gather the time (µs) of each part of redraw()
var profile: Variant = null
var _lap_t := 0

var _shake := 0.0
var _layers: Array[RID] = []
var _holder: Node2D
var _sv: SubViewport
var _root: Node2D
var _show: CanvasLayer
var _pic: TextureRect
var _ear: AudioListener2D
var _mats: Array[Material] = []
var _view := Rect2()
var _tile_draw: Array = []  # per tile: null or Array of [key, Sheet, Vector2]
var _tile_lamps: Array = []  # per tile: null or PackedVector2Array of window lights
var _ore_frame := PackedInt32Array()
var _fog_img: Image
var _fog_tex: ImageTexture
var _fog_bytes := PackedByteArray()
var _ufac: Array[String] = []
# the sorted list
var _keys := PackedInt64Array()
var _ik := PackedInt32Array()
var _iref: Array = []
var _ifr := PackedInt32Array()
var _ipos := PackedVector2Array()
var _air: Array[Ent] = []
# the effects in view
var _fv: Array[Game.Fx] = []
var _fq := PackedVector2Array()
# lights
var _lx := PackedFloat32Array()
var _lc := PackedColorArray()

enum { L_SHADOW, L_OBJ, L_AIR_ADD, L_CLOUD, L_LOW, L_GRADE, L_LIGHT, L_SHOT, L_HIGH, L_HIGH_ADD, L_RAIN, L_BARS, L_FOG, L_OVER, L_COUNT }


func setup(g: Game) -> void:
	game = g
	Art.load_all()
	var N := g.map.N
	_sv = SubViewport.new()
	_sv.disable_3d = true
	_sv.snap_2d_transforms_to_pixel = true
	_sv.snap_2d_vertices_to_pixel = true
	_sv.canvas_item_default_texture_filter = Viewport.DEFAULT_CANVAS_ITEM_TEXTURE_FILTER_NEAREST
	_sv.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	add_child(_sv)
	_root = Node2D.new()
	_sv.add_child(_root)
	_show = CanvasLayer.new()
	_show.layer = -1
	add_child(_show)
	_pic = TextureRect.new()
	_pic.texture = _sv.get_texture()
	_pic.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	_pic.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_pic.stretch_mode = TextureRect.STRETCH_SCALE
	_pic.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_show.add_child(_pic)
	_ear = AudioListener2D.new()
	add_child(_ear)
	# the dark beyond the edges of the map
	var bg := Node2D.new()
	_root.add_child(bg)
	RenderingServer.canvas_item_add_rect(bg.get_canvas_item(), Rect2(-N * 32.0 - 6000, -6000, N * 64.0 + 12000, N * 32.0 + 12000), Color("#141a12"))
	terrain = Terrain.new()
	_root.add_child(terrain)
	terrain.setup(g.map)
	atmos = Atmos.new(g.map, String(g.opts.get("tod", "day")), String(g.opts.get("weather", "clear")))
	for w in atmos.water_nodes:
		_root.add_child(w)
	_holder = Node2D.new()
	_root.add_child(_holder)
	var add_mat := CanvasItemMaterial.new()
	add_mat.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
	var mul_mat := CanvasItemMaterial.new()
	mul_mat.blend_mode = CanvasItemMaterial.BLEND_MODE_MUL
	_mats = [add_mat, mul_mat]
	for i in L_COUNT:
		var ci := RenderingServer.canvas_item_create()
		RenderingServer.canvas_item_set_parent(ci, _holder.get_canvas_item())
		RenderingServer.canvas_item_set_draw_index(ci, i)
		if i == L_AIR_ADD or i == L_LIGHT or i == L_HIGH_ADD:
			RenderingServer.canvas_item_set_material(ci, add_mat.get_rid())
		if i == L_GRADE:
			RenderingServer.canvas_item_set_material(ci, mul_mat.get_rid())
		if i == L_AIR_ADD or i == L_LIGHT or i == L_HIGH_ADD or i == L_FOG or i == L_CLOUD:
			RenderingServer.canvas_item_set_default_texture_filter(ci, RenderingServer.CANVAS_ITEM_TEXTURE_FILTER_LINEAR)
		if i == L_CLOUD:
			RenderingServer.canvas_item_set_default_texture_repeat(ci, RenderingServer.CANVAS_ITEM_TEXTURE_REPEAT_ENABLED)
		_layers.append(ci)
	# what stands on each tile, worked out once
	_tile_draw.resize(N * N)
	_tile_lamps.resize(N * N)
	_ore_frame.resize(N * N)
	for i in N * N:
		var st: Variant = g.map.tile_statics[i]
		if st is Array and not st.is_empty():
			var list := []
			var lamps := PackedVector2Array()
			for s in st:
				var arr: Array = Art.statics.get(s["kind"], [])
				if arr.is_empty():
					continue
				var sp: Sheet = arr[int(s["v"]) % arr.size()][0]
				var x := float(s["x"])
				var y := float(s["y"])
				list.append([x + y, sp, _scr(x, y)])
				var k: String = s["kind"]
				if k != "oak" and k != "pine" and k != "birch" and k != "barn":
					lamps.append(_scr(x + 0.2, y + 0.2, 4))
			_tile_draw[i] = list
			if not lamps.is_empty():
				_tile_lamps[i] = lamps
		_ore_frame[i] = int(Rng.hash2(i % N, i / N, 5) * 3)
	for p in g.players:
		_ufac.append(p.faction)
	_fog_img = Image.create(N, N, false, Image.FORMAT_RGBA8)
	_fog_bytes.resize(N * N * 4)
	_fog_tex = ImageTexture.create_from_image(_fog_img)
	g.fog_dirty = true
	camera = Camera2D.new()
	_root.add_child(camera)
	if is_inside_tree():
		camera.make_current()
		_ear.make_current()
	zoom_level = 1 if _screen().x > 1500 else 0
	_resize()
	if is_inside_tree():
		get_tree().root.size_changed.connect(_on_resize)


func _ready() -> void:
	if camera:
		camera.make_current()
		_ear.make_current()
	if game and not get_tree().root.size_changed.is_connected(_on_resize):
		get_tree().root.size_changed.connect(_on_resize)


func _on_resize() -> void:
	var keep := camera.position
	_resize()
	camera.position = keep
	clamp_camera()


## the window (or whatever viewport the world sits in), in screen pixels
func _screen() -> Vector2:
	return get_viewport_rect().size


## the picture is the screen divided by the zoom (rounded up to even sizes, so the view's corner
## stays on whole pixels), shown scaled up from the top left corner like the prototype's canvas
func _resize() -> void:
	var s := _screen() / zoom
	var w := int(ceilf(s.x / 2.0)) * 2
	var h := int(ceilf(s.y / 2.0)) * 2
	_sv.size = Vector2i(maxi(2, w), maxi(2, h))
	_pic.position = Vector2.ZERO
	_pic.size = Vector2(_sv.size) * zoom


func _exit_tree() -> void:
	for r in _layers:
		RenderingServer.free_rid(r)
	_layers.clear()


func _process(delta: float) -> void:
	if auto_draw and game:
		redraw(0.0 if paused else minf(0.1, delta))


# ─────────────────────────────────────────────────────────────── camera and coordinates

## world tiles (and height) → world pixels
func tile_to_px(x: float, y: float, z := 0.0) -> Vector2:
	return Vector2((x - y) * 32.0, (x + y) * 16.0 - z * KZ)


## world pixels on the ground → world tiles
func px_to_tile(p: Vector2) -> Vector2:
	var a := p.x / 32.0
	var b := p.y / 16.0
	return Vector2((a + b) / 2.0, (b - a) / 2.0)


## a point on the screen (viewport pixels) → world pixels
func screen_to_px(p: Vector2) -> Vector2:
	return camera.position - Vector2(_sv.size) / 2.0 + p / zoom


## a point in world pixels → the screen (viewport pixels)
func px_to_screen(p: Vector2) -> Vector2:
	return (p - camera.position + Vector2(_sv.size) / 2.0) * zoom


## the size of the view in world pixels
func _view_size() -> Vector2:
	return Vector2(_sv.size)


func set_zoom_level(i: int, anchor_screen := Vector2.INF) -> void:
	i = clampi(i, 0, LEVELS.size() - 1)
	if anchor_screen == Vector2.INF:
		anchor_screen = _screen() / 2.0
	var keep := screen_to_px(anchor_screen)
	zoom_level = i
	_resize()
	camera.position = (keep - anchor_screen / zoom + Vector2(_sv.size) / 2.0).round()
	clamp_camera()


## move the view by a distance in screen pixels (positive x: the view goes right)
func pan_screen(delta: Vector2) -> void:
	camera.position += delta / zoom
	clamp_camera()


## centre the view on a world position (tiles)
func look_at_tile(x: float, y: float) -> void:
	camera.position = tile_to_px(x, y).round()
	clamp_camera()


func clamp_camera() -> void:
	var N := game.map.N
	var vs := _view_size()
	var half := N * 64.0 / 2.0
	var cx := camera.position.x - vs.x / 2.0
	var cy := camera.position.y - vs.y / 2.0
	cx = maxf(-half - 40 * P, minf(half - vs.x + 40 * P, cx))
	cy = maxf(-40 * P, minf(N * 32.0 - vs.y + 40 * P, cy))
	camera.position = Vector2(roundf(cx) + vs.x / 2.0, roundf(cy) + vs.y / 2.0)


func add_shake(k: float) -> void:
	_shake = minf(7 * P, _shake + k * P)


# ─────────────────────────────────────────────────────────────── picking

## what stands under a point (world pixels), topmost first
func pick(px: Vector2) -> Ent:
	var g := game
	var best: Ent = null
	var bk := -1e9
	for e in g.ents:
		if e.dead:
			continue
		if e.owner != 0 and not shown(e):
			continue
		if e.is_b:
			# test the point at a few heights against the footprint
			for zi in 14:
				var w := px_to_tile(Vector2(px.x, px.y + zi * 2 * KZ))
				if w.x >= e.tx and w.x < e.tx + e.w and w.y >= e.ty and w.y < e.ty + e.h:
					var k := e.x + e.y - 0.5
					if k > bk:
						bk = k
						best = e
					break
		else:
			if e.carried_by != null or e.inside != null:
				continue
			var s := _scr(e.x, e.y, e.z)
			var r := (7.0 if e.infantry else ((26.0 if e.radius > 0.9 else 17.0) if e.naval else 13.0)) * P
			var cy := s.y - (8.0 if e.infantry or e.naval else 6.0) * P
			if absf(px.x - s.x) <= r and absf(px.y - cy) <= r:
				var k := e.x + e.y + (100.0 if e.air else 0.0)
				if k > bk:
					bk = k
					best = e
	return best


## a house (or bunker) that soldiers can hold under a point (world pixels)
func pick_garrison(px: Vector2) -> Game.Garrison:
	var g := game
	var N := g.map.N
	var best: Game.Garrison = null
	var bk := -1e9
	for h in g.garrisons:
		if not g.fog[h.ty * N + h.tx]:
			continue
		var top := 40 if h.kind == "church" else (12 if h.kind == "bunker" else 24)
		for z in range(0, top + 1, 2):
			var w := px_to_tile(Vector2(px.x, px.y + z * KZ))
			if w.x >= h.tx and w.x < h.tx + h.w and w.y >= h.ty and w.y < h.ty + h.h:
				if h.x + h.y > bk:
					bk = h.x + h.y
					best = h
				break
	return best


## is an entity drawn (own ones always, others when seen)
func shown(e: Ent) -> bool:
	var g := game
	if e.carried_by != null or e.inside != null:
		return false
	if e.owner == 0:
		return true
	if e.hidden and not g.visible_to(0, e):
		return false
	var N := g.map.N
	if e.is_b:
		for y in range(e.ty, e.ty + e.h):
			for x in range(e.tx, e.tx + e.w):
				if g.fog[y * N + x]:
					return true
		return false
	var tx := floori(e.x)
	var ty := floori(e.y)
	if tx < 0 or ty < 0 or tx >= N or ty >= N:
		return false
	return g.fog[ty * N + tx] == 2


func _visible_pt(x: float, y: float) -> bool:
	var N := game.map.N
	var tx := floori(x)
	var ty := floori(y)
	if tx < 0 or ty < 0 or tx >= N or ty >= N:
		return false
	return game.fog[ty * N + tx] == 2


# ─────────────────────────────────────────────────────────────── helpers

## world tiles → world pixels, rounded like the prototype
static func _scr(x: float, y: float, z := 0.0) -> Vector2:
	return Vector2(floorf((x - y) * 32.0 + 0.5), floorf((x + y) * 16.0 - z * KZ + 0.5))


func _on_screen(x: float, y: float, m := 60.0 * P) -> bool:
	var sx := (x - y) * 32.0 - _view.position.x
	var sy := (x + y) * 16.0 - _view.position.y
	return sx > -m and sx < _view.size.x + m and sy > -m and sy < _view.size.y + m * 1.5


static func _rect(ci: RID, x: float, y: float, w: float, h: float, c: Color) -> void:
	# a canvas fills a rectangle of negative size the other way round
	if w < 0:
		x += w
		w = -w
	if h < 0:
		y += h
		h = -h
	RenderingServer.canvas_item_add_rect(ci, Rect2(x, y, w, h), c)


## a line of t × t squares as the prototype stamps them
static func _line(ci: RID, x0: float, y0: float, x1: float, y1: float, c: Color, t := 1.0) -> void:
	var h := t * 0.5
	if x0 == x1 and y0 == y1:
		RenderingServer.canvas_item_add_rect(ci, Rect2(x0, y0, t, t), c)
		return
	var d := Vector2(x1 - x0, y1 - y0)
	# the squares at both ends reach half a square further
	var e := d / maxf(absf(d.x), absf(d.y)) * h
	RenderingServer.canvas_item_add_line(ci, Vector2(x0 + h, y0 + h) - e, Vector2(x1 + h, y1 + h) + e, c, t)


static func _ellipse(ci: RID, cx: float, cy: float, rx: float, ry: float, c: Color) -> void:
	var pts := PackedVector2Array()
	for i in 20:
		var a := i / 20.0 * TAU
		pts.append(Vector2(cx + cos(a) * rx, cy + sin(a) * ry))
	RenderingServer.canvas_item_add_polygon(ci, pts, PackedColorArray([c]))


static func _ring(ci: RID, cx: float, cy: float, r: int, c: Color) -> void:
	var tex := Art.ring(r)
	RenderingServer.canvas_item_add_texture_rect(ci, Rect2(cx - r - 1, cy - floorf(r / 2.0) - 1, r * 2 + 3, r + 3), tex.get_rid(), false, c)


## a soft light of radius r (additive layers)
static func _glow(ci: RID, x: float, y: float, r: float, c: Color) -> void:
	RenderingServer.canvas_item_add_texture_rect(ci, Rect2(roundf(x - r), roundf(y - r), r * 2, r * 2), Art.glow().get_rid(), false, c)


func _footprint(ci: RID, tx: float, ty: float, w: float, h: float, col: Color, alpha: float) -> void:
	var a := _scr(tx, ty)
	var b := _scr(tx + w, ty)
	var c := _scr(tx + w, ty + h)
	var d := _scr(tx, ty + h)
	col.a = alpha
	for pq in [[a, b], [b, c], [c, d], [d, a]]:
		var p: Vector2 = pq[0]
		var q: Vector2 = pq[1]
		_line(ci, p.x, p.y, Rng.js_round(p.x + (q.x - p.x) * 0.25), Rng.js_round(p.y + (q.y - p.y) * 0.25), col, P)
		_line(ci, q.x, q.y, Rng.js_round(q.x + (p.x - q.x) * 0.25), Rng.js_round(q.y + (p.y - q.y) * 0.25), col, P)


func _shot_at(s: Game.Shot, t: float) -> Vector3:
	var p := minf(1.0, t / s.T)
	return Vector3(s.x0 + (s.x1 - s.x0) * p, s.y0 + (s.y1 - s.y0) * p, s.z0 + (s.z1 - s.z0) * p + s.arc * 4 * p * (1 - p))


# ─────────────────────────────────────────────────────────────── the frame

func redraw(dt := 1.0 / 60.0) -> void:
	var t0 := Time.get_ticks_usec()
	var g := game
	var N := g.map.N
	# marks waiting to be painted into the ground
	for s in g.stamps:
		terrain.stamp(s.kind, s.size, s.x, s.y)
	g.stamps.clear()
	for i in g.ore_changed:
		terrain.repaint_tile(i % N, i / N)
	g.ore_changed.clear()

	var sh := Vector2.ZERO
	if _shake > 0.05:
		sh = Vector2(Rng.js_round((randf() - 0.5) * _shake * 2), Rng.js_round((randf() - 0.5) * _shake * 2))
		_shake *= 0.86
	camera.offset = sh
	_ear.position = camera.position
	var vs := _view_size()
	_view = Rect2(camera.position - vs / 2.0 + sh, vs)
	for ci in _layers:
		RenderingServer.canvas_item_clear(ci)

	# the tiles in view (with a margin for tall things)
	var X0 := _view.position.x - 40 * P
	var X1 := _view.end.x + 40 * P
	var Y0 := _view.position.y - 60 * P
	var Y1 := _view.end.y + 60 * P
	var ty0 := maxi(0, floori(minf(px_to_tile(Vector2(X1, Y0)).y, px_to_tile(Vector2(X0, Y0)).y)))
	var ty1 := mini(N - 1, ceili(px_to_tile(Vector2(X0, Y1)).y))
	atmos.water(g.time)
	_lap("")

	_draw_shadows()
	_lap("_draw_shadows")
	_draw_objects(X0, X1, Y0, Y1, ty0, ty1)
	_lap("_draw_objects")

	# cloud shadows drift over everything on the ground
	var cl := _layers[L_CLOUD]
	atmos.clouds(cl, _view, g.time)
	# selected buildings get corner brackets on top
	var hov: Variant = overlay.get("hover_ent")
	for e in g.ents:
		if not e.is_b or e.dead or (not e.selected and hov != e) or not _on_screen(e.x, e.y):
			continue
		if e.owner != 0 and not shown(e):
			continue
		_footprint(cl, e.tx, e.ty, e.w, e.h, C_SEL if e.owner == 0 else C_FOE, 0.9 if e.selected else 0.5)

	_gather_fx()
	_draw_fx_low()
	_lap("_draw_fx_low")
	var gr: Variant = atmos.grade()
	if gr != null:
		_rect(_layers[L_GRADE], _view.position.x - 8, _view.position.y - 8, _view.size.x + 16, _view.size.y + 16, gr)
	_draw_lights(X0, X1, Y0, Y1, ty0, ty1)
	_lap("_draw_lights")
	_draw_shots()
	_lap("_draw_shots")
	_draw_fx_high()
	_lap("_draw_fx_high")
	atmos.rain(_layers[L_RAIN], _view, dt)
	_draw_bars()
	_lap("_draw_bars")
	_draw_garrisons()
	_lap("_draw_garrisons")
	_draw_fog()
	_lap("_draw_fog")
	_draw_overlay()
	_lap("_draw_overlay")
	draw_ms = (Time.get_ticks_usec() - t0) / 1000.0


func _lap(name: String) -> void:
	if profile == null:
		return
	var t := Time.get_ticks_usec()
	if name != "":
		profile[name] = profile.get(name, 0) + t - _lap_t
	_lap_t = t


func _tile_span(ty: int, X0: float, X1: float, Y0: float, Y1: float) -> Vector2i:
	var N := game.map.N
	var a := maxi(0, maxi(floori(ty + (X0 - 64) / 32.0), floori((Y0 - 32) / 16.0 - ty)))
	var b := mini(N - 1, mini(ceili(ty + (X1 + 64) / 32.0), ceili((Y1 + 32) / 16.0 - ty)))
	return Vector2i(a, b)


func _draw_shadows() -> void:
	var g := game
	var ci := _layers[L_SHADOW]
	for e in g.ents:
		if e.dead or not _on_screen(e.x, e.y) or not shown(e):
			continue
		var f := _ufac[e.owner]
		if e.is_b:
			if e.built < 1:
				continue
			var ba := Art.building(f, e.key)
			if ba.shadow:
				var s := _scr(e.x, e.y)
				ba.shadow.draw(ci, 0, s.x, s.y)
		else:
			var ua := Art.unit(f, e.key)
			var shs := ua.shadow
			if shs == null:
				continue
			if e.air:
				var k := e.z * 0.85 * (0.7 if e.jet else 1.0)
				var s := _scr(e.x + k * 0.035, e.y + k * 0.016)
				shs.draw(ci, shs.dir(e.dir), s.x, s.y, Color(1, 1, 1, 0.7))
			else:
				var s := _scr(e.x, e.y)
				shs.draw(ci, shs.dir(e.dir), s.x, s.y)
	# markers on the ground: selection rings
	var hov: Variant = overlay.get("hover_ent")
	for e in g.ents:
		if e.dead or e.carried_by != null or e.inside != null or e.is_b or not _on_screen(e.x, e.y):
			continue
		var hover: bool = hov == e
		if not e.selected and not hover:
			continue
		if e.owner != 0 and not shown(e):
			continue
		var col := (C_SEL if e.selected else C_HOVER) if e.owner == 0 else C_FOE
		var s := _scr(e.x, e.y)
		var r := int(Rng.js_round((5.0 if e.infantry else e.urad * (24.0 if e.naval else 22.0)) * P))
		col.a = 1.0 if e.selected else 0.55
		_ring(ci, s.x, s.y, r, col)


func _push(key: float, kind: int, ref: Variant, fr: int, pos: Vector2) -> void:
	var i := _ik.size()
	_keys.append((int(floorf(key * 4096.0 + 0.5)) + 8192) << 20 | i)
	_ik.append(kind)
	_iref.append(ref)
	_ifr.append(fr)
	_ipos.append(pos)


func _draw_objects(X0: float, X1: float, Y0: float, Y1: float, ty0: int, ty1: int) -> void:
	var g := game
	var m := g.map
	var N := m.N
	var ci := _layers[L_OBJ]
	_keys.clear()
	_ik.clear()
	_iref.clear()
	_ifr.clear()
	_ipos.clear()
	_air.clear()
	for ty in range(ty0, ty1 + 1):
		var sp := _tile_span(ty, X0, X1, Y0, Y1)
		for tx in range(sp.x, sp.y + 1):
			var i := ty * N + tx
			if g.fog[i]:
				var st: Variant = _tile_draw[i]
				if st != null:
					for s in st:
						_push(s[0], 0, s[1], 0, s[2])
			if m.ter[i] == GameMap.ORE and m.ore[i] > 0:
				var amt := m.ore[i]
				var stage := 2 if amt > 600 else (1 if amt > 250 else 0)
				_push(tx + ty + 0.6, 0, Art.ore[stage], _ore_frame[i], _scr(tx + 0.5, ty + 0.5))
	for w in g.wrecks:
		if not _on_screen(w.x, w.y) or g.fog[floori(w.y) * N + floori(w.x)] == 0:
			continue
		var art := Art.unit(_ufac[w.owner], w.key)
		if art.wreck == null:
			continue
		_push(w.x + w.y, 1, w, 0, Vector2.ZERO)
	for e in g.ents:
		if e.dead or not _on_screen(e.x, e.y, 90 * P) or not shown(e):
			continue
		if e.air and e.z > 3:
			_air.append(e)
			continue
		_push(e.x + e.y + (0.3 if e.air else 0.0), 2, e, 0, Vector2.ZERO)
	_keys.sort()
	for k in _keys:
		var i := k & 0xFFFFF
		match _ik[i]:
			0:
				var s: Sheet = _iref[i]
				var p := _ipos[i]
				s.draw(ci, _ifr[i], p.x, p.y)
			1:
				_draw_wreck(ci, _iref[i])
			2:
				_draw_ent(ci, _iref[i])
	_air.sort_custom(func(a: Ent, b: Ent) -> bool: return a.z < b.z if a.z != b.z else a.x + a.y < b.x + b.y)
	for e in _air:
		_draw_ent(ci, e)


func _draw_wreck(ci: RID, w: Game.Wreck) -> void:
	var art := Art.unit(_ufac[w.owner], w.key)
	var p := _scr(w.x, w.y)
	var fade := maxf(0.0, 1 - w.t / 9.0) if w.naval else (1 - (w.t - 34) / 6.0 if w.t > 34 else 1.0)
	if fade <= 0:
		return
	var mod := Color(1, 1, 1, fade)
	var wr := art.wreck
	if w.naval:
		# going down: only what is still above the water shows
		var sink := Rng.js_round(w.t * w.t * 0.35)
		var tilt := minf(0.6, w.t * 0.08)
		var top := p.y + sink - wr.ay
		wr.draw_rows(ci, wr.dir(w.dir + tilt), p.x, p.y + sink, 0, int(p.y + 3 - top), mod)
		return
	wr.draw(ci, wr.dir(w.dir), p.x, p.y, mod)
	if art.wreck_turret and not art.mount_offsets.is_empty():
		var o := art.mount_offsets[posmod(int(floorf(w.dir / TAU * 32 + 0.5)), 32)]
		var wt := art.wreck_turret
		wt.draw(ci, wt.dir(w.tdir), p.x + roundf(o.x), p.y + roundf(o.y), mod)


func _draw_ent(ci: RID, e: Ent) -> void:
	var g := game
	var f := _ufac[e.owner]
	if e.is_b:
		var ba := Art.building(f, e.key)
		var s := _scr(e.x, e.y)
		var sp := ba.body
		if e.built < 1:
			# rises out of the ground
			var top := floori(sp.ch * (1 - e.built))
			sp.draw_rows(ci, 0, s.x, s.y, top, sp.ch)
			if randf() < 0.3:
				g.add_fx("dust", e.tx + randf() * e.w, e.ty + e.h, 1, 0, 0, 3, 0.8, 2)
			return
		sp.draw(ci, 0, s.x, s.y)
		if ba.turret:
			ba.turret.draw(ci, ba.turret.dir(e.tdir), s.x + roundf(ba.mount_offset.x), s.y + roundf(ba.mount_offset.y))
		return
	var art := Art.unit(f, e.key)
	var s := _scr(e.x, e.y, e.z)
	var flash := g.time - e.flash_t < 0.07
	# a sniper in hiding is a ghost to its own side
	var mod := Color(1, 1, 1, 0.45 if e.hidden else 1.0)
	if flash:
		# the white blink of a hit (the prototype adds the sprite over itself at 0.55)
		mod = Color(1.55, 1.55, 1.55, mod.a)
	if e.infantry:
		var aiming := not e.moving and (g.time - e.fired_t < 0.8 or (e.target != null and not e.target.dead))
		var fr: Sheet = art.hull
		if e.moving:
			fr = art.walk1 if int(floorf(e.anim * 7)) % 2 else art.walk2
		elif aiming and art.aim:
			fr = art.aim
		fr.draw(ci, fr.dir(e.dir), s.x, s.y, mod)
		return
	# the tracks run while it drives; radars on ships keep turning
	var hull: Sheet = art.alt if e.u.get("harvester", false) and e.cargo > 0 and art.alt else art.hull
	if art.hull2 and e.moving and int(floorf(e.anim * 12)) % 2:
		hull = art.hull2
	if not art.hull_anim.is_empty():
		hull = art.hull_anim[int(floorf(g.time * 3 + e.id)) % art.hull_anim.size()]
	var turret: Sheet = art.turret_anim[int(floorf(g.time * 4 + e.id)) % art.turret_anim.size()] if not art.turret_anim.is_empty() else art.turret
	# a little bounce while driving, a slow roll on the water
	var bob := 0.0
	if e.naval:
		bob = Rng.js_round(sin(g.time * 1.4 + e.id) * 0.7)
	elif e.moving and not e.air and int(floorf(e.anim * 8)) % 2:
		bob = -1.0
	hull.draw(ci, hull.dir(e.dir), s.x, s.y + bob, mod)
	if turret and not art.mount_offsets.is_empty():
		var o := art.mount_offsets[posmod(int(floorf(e.dir / TAU * 32 + 0.5)), 32)]
		turret.draw(ci, turret.dir(e.tdir), s.x + roundf(o.x), s.y + roundf(o.y) + bob, mod)
	if e.jet and e.js != "park" and e.z > 3:
		# afterburners at the nozzles
		var bu: Dictionary = art.burner if not art.burner.is_empty() else {"back": 14, "side": 0, "z": 2}
		var back := float(bu["back"])
		var side_w := float(bu["side"])
		var c := cos(e.dir)
		var sn := sin(e.dir)
		var flick := int(floorf(g.time * 30 + e.id)) % 2
		var sides := [-1.0, 1.0] if side_w > 1 else [0.0]
		for side in sides:
			var ox: float = (-c * back - sn * side * side_w) / 16.0
			var oy: float = (-sn * back + c * side * side_w) / 16.0
			var q := _scr(e.x + ox, e.y + oy, e.z + float(bu["z"]))
			_glow(_layers[L_AIR_ADD], q.x, q.y, 5 * P, Color(1, 150 / 255.0, 60 / 255.0, 0.9))
			_rect(ci, q.x - P - flick, q.y - P, 2 * P + flick * 2, 2 * P, Color("#ff8a30"))
			_rect(ci, q.x - 1, q.y - 1, 2, 2, Color("#fff2b0"))
	if not art.rotor.is_empty():
		_draw_rotor(ci, e, art.rotor, s)


## the main rotor: its blades (4 on the Apache, 5 on the Hind), a blur behind each, a faint disc;
## the tail rotor turning in its upright plane at the end of the boom
func _draw_rotor(ci: RID, e: Ent, R: Dictionary, s: Vector2) -> void:
	var g := game
	var cx := s.x
	var cy := s.y - float(R["z"]) * KZ
	var r := float(R["r"]) * P * 0.72
	_ellipse(ci, cx, cy, r * 1.42, r * 0.71, Color(Color("#d8dcd0"), 0.13))
	var n := int(R.get("blades", 2))
	var a := (g.time * 23 + e.id) * (1.0 if e.z > 2 else 0.15)
	var rcx := Rng.js_round(cx)
	var rcy := Rng.js_round(cy)
	for k in n:
		var ang := a + k * TAU / n
		# blurred copies trail behind (squares overlap along the line, so they read darker)
		for lag_al in [[0.32, 0.12], [0.16, 0.25]]:
			var al: float = 1.0 - pow(1.0 - lag_al[1], 3.0)
			var tp := _tip(cx, cy, r, ang - lag_al[0])
			_line(ci, rcx, rcy, tp.x, tp.y, Color(Color("#3a3c36"), al), P)
		var tp2 := _tip(cx, cy, r, ang)
		_line(ci, rcx, rcy, tp2.x, tp2.y, Color("#24261f"), P)
	_rect(ci, rcx - P, rcy - P, 2 * P, 2 * P, Color("#4a4c44"))
	var tail := Art.mount_offset(float(R.get("tailSide", 1)) * 1.3, -float(R["tail"]) + 1.5, float(R["z"]) - 2.5, e.dir)
	var qx := s.x + tail.x
	var qy := s.y + tail.y
	var ux := cos(e.dir) - sin(e.dir)
	var uy := (cos(e.dir) + sin(e.dir)) / 2.0
	var ul := Vector2(ux, uy).length()
	if ul == 0:
		ul = 1
	var rr := 3.2 * P
	_ellipse(ci, qx, qy, rr * absf(ux / ul) + 1, rr, Color(Color("#d8dcd0"), 0.18))
	for off in [0.0, PI / 2]:
		var at: float = g.time * 40 + off + e.id
		var ex := cos(at) * rr * (ux / ul)
		var ey := cos(at) * rr * (uy / ul) - sin(at) * rr
		_line(ci, Rng.js_round(qx - ex), Rng.js_round(qy - ey), Rng.js_round(qx + ex), Rng.js_round(qy + ey), Color("#2a2c28"))


static func _tip(cx: float, cy: float, r: float, ang: float) -> Vector2:
	var bx := cos(ang) * r
	var by := sin(ang) * r
	return Vector2(Rng.js_round(cx + bx - by), Rng.js_round(cy + (bx + by) / 2.0))


## the effects that can be seen, once per frame: in view (with a margin) and where the player sees;
## an explosion shakes the view and lights it up even out of view, as in the prototype
func _gather_fx() -> void:
	var g := game
	var N := g.map.N
	var fog := g.fog
	_fv.clear()
	_fq.clear()
	var vr := _view.grow(300)
	var ad := _layers[L_HIGH_ADD]
	for f in g.fx:
		if f.t < 0:
			continue
		var tx := floori(f.x)
		var ty := floori(f.y)
		if tx < 0 or ty < 0 or tx >= N or ty >= N or fog[ty * N + tx] != 2:
			continue
		if f.ki == 0:
			var size := int(f.size)
			if not f.shook and size >= 1:
				f.shook = true
				add_shake([0.4, 1.4, 2.8, 4.5][mini(3, size)])
			if f.t < 0.05 and size >= 2:
				# the whole view lights up for a moment
				_rect(ad, _view.position.x - 8, _view.position.y - 8, _view.size.x + 16, _view.size.y + 16, Color(1, 220 / 255.0, 170 / 255.0, 0.09 * size * (1 - f.t / 0.05)))
		var q := Vector2(floorf((f.x - f.y) * 32.0 + 0.5), floorf((f.x + f.y) * 16.0 - f.z * KZ + 0.5))
		if not vr.has_point(q):
			continue
		_fv.append(f)
		_fq.append(q)


## smoke, dust and water: lit like the ground around them
func _draw_fx_low() -> void:
	var ci := _layers[L_LOW]
	for j in _fv.size():
		var f: Game.Fx = _fv[j]
		var ki := f.ki
		if ki != 1 and ki != 5 and ki != 6 and ki != 10 and ki != 7 and ki != 8:
			continue
		var kind := f.kind
		var q := _fq[j]
		var k := f.t / f.life
		match kind:
			"smoke", "dust":
				# the heavy smoke of a blast is dark, big and grows as it rises
				var heavy := kind == "smoke" and f.size >= 4
				var set_: Sheet = Art.dust if kind == "dust" else (Art.soot if heavy else Art.smoke)
				var r := mini(set_.n - 1, int(Rng.js_round(f.size * 0.9 + k * 7)) - 2) if heavy else mini(8, int(Rng.js_round(f.size + k * 3)) - 1)
				set_.draw(ci, maxi(0, r), q.x, q.y, Color(1, 1, 1, (1 - k) * (0.5 if kind == "dust" else (0.85 if heavy else 0.7))))
			"debris":
				var big := f.size >= 3
				_rect(ci, q.x, q.y, (4 if big else 2) * P, (3 if big else 1) * P, Color("#ffb050") if k < 0.25 else Color("#2a2622"))
			"clod":
				# earth thrown up by a blast
				var al := (1 - k) / 0.3 if k > 0.7 else 1.0
				var h := Rng.hash2(int(Rng.js_round(f.vx * 1000)), int(Rng.js_round(f.life * 1000)), 3)
				var col := Color("#4a3a28") if h < 0.35 else (Color("#6a5438") if h < 0.7 else Color("#2e261e"))
				col.a = al
				var hh := f.size - 1
				if hh == 0:
					hh = 1
				_rect(ci, q.x, q.y, f.size * P - 1, hh * P, col)
				_rect(ci, q.x, q.y, 2 if f.size >= 3 else 1, 1, Color(Color("#8a7252"), al))
			"wake":
				# foam spreading behind a boat
				var r := Rng.js_round(f.size * P * (0.6 + k * 1.4))
				var al := (1 - k) * 0.75
				var c1 := Color(Color("#eef6f6"), al)
				_rect(ci, q.x - r, q.y, r * 2 + 1, 1, c1)
				_rect(ci, q.x - r + 2, q.y + 1, r * 2 - 3, 1, c1)
				if r > 2:
					var c2 := Color(Color("#c8dde2"), al)
					_rect(ci, q.x - r + 1, q.y - 1, 2, 1, c2)
					_rect(ci, q.x + r - 2, q.y + 2, 2, 1, c2)
			"splash":
				# a column of water and its ring
				var h := Rng.js_round(sin(minf(1, k * 1.4) * PI) * (6 + f.size * 6) * P)
				var w := (1 + f.size) * P
				var al := 1 - k * 0.7
				_rect(ci, q.x - w, q.y - h, w * 2, h, Color(Color("#e8f2f6"), al))
				_rect(ci, q.x - w, q.y - h, P, h, Color(Color("#b8d4e0"), al))
				_rect(ci, q.x - Rng.js_round(w / 2), q.y - h, w, P, Color(1, 1, 1, al))
				var rr := int(Rng.js_round((2 + k * (5 + f.size * 3)) * P))
				_ring(ci, q.x, q.y, rr, Color(Color("#d8eef4"), al))


func _light(x: float, y: float, r: float, c: Color, a: float) -> void:
	_lx.append(x)
	_lx.append(y)
	_lx.append(r)
	_lx.append(a)
	_lc.append(c)


## what shines in the dark: windows, headlights, navigation lights; fires and explosions always
func _draw_lights(X0: float, X1: float, Y0: float, Y1: float, ty0: int, ty1: int) -> void:
	var g := game
	var N := g.map.N
	var level := atmos.light_level
	_lx.clear()
	_lc.clear()
	if level > 0:
		var blink := int(floorf(g.time * 1.5)) % 2 == 0
		for e in g.ents:
			if e.dead or e.carried_by != null or e.inside != null or not _on_screen(e.x, e.y) or not shown(e):
				continue
			if e.is_b:
				if e.built < 1:
					continue
				var n := mini(2, e.w + e.h - 2)
				for k in n:
					var q := _scr(e.tx + 0.3 + Rng.hash2(e.id, k, 1) * (e.w - 0.6), e.ty + 0.3 + Rng.hash2(e.id, k, 2) * (e.h - 0.6), 6 + Rng.hash2(e.id, k, 3) * 6)
					_light(q.x, q.y, 8 * P, Color(1, 214 / 255.0, 140 / 255.0, 0.85), level * 0.75)
				if blink:
					var q := _scr(e.x, e.y, 16 + e.w * 3)
					_light(q.x, q.y, 4 * P, Color(120 / 255.0, 1, 120 / 255.0) if e.owner == 0 else Color(1, 90 / 255.0, 70 / 255.0), level)
				continue
			if e.infantry:
				continue
			if e.air:
				if blink:
					var q := _scr(e.x, e.y, e.z)
					_light(q.x, q.y, 4 * P, Color(1, 70 / 255.0, 60 / 255.0), level)
				continue
			if e.naval:
				var q := _scr(e.x, e.y, 8)
				_light(q.x, q.y, (10 + e.urad * 8) * P, Color(1, 220 / 255.0, 150 / 255.0, 0.8), level * 0.6)
				var l := _scr(e.x - sin(e.dir) * e.urad * 0.5, e.y + cos(e.dir) * e.urad * 0.5, 6)
				var r := _scr(e.x + sin(e.dir) * e.urad * 0.5, e.y - cos(e.dir) * e.urad * 0.5, 6)
				_light(l.x, l.y, 3 * P, Color(80 / 255.0, 1, 120 / 255.0), level)
				_light(r.x, r.y, 3 * P, Color(1, 60 / 255.0, 60 / 255.0), level)
				continue
			# headlights on the ground ahead
			var q := _scr(e.x + cos(e.dir) * 0.8, e.y + sin(e.dir) * 0.8, 1)
			_light(q.x, q.y, 10 * P, Color(1, 245 / 255.0, 210 / 255.0, 0.8), level * 0.7)
		# windows in the villages
		for ty in range(ty0, ty1 + 1):
			var sp := _tile_span(ty, X0, X1, Y0, Y1)
			for tx in range(sp.x, sp.y + 1):
				var i := ty * N + tx
				if not g.fog[i]:
					continue
				var lamps: Variant = _tile_lamps[i]
				if lamps == null:
					continue
				for q in lamps:
					_light(q.x, q.y, 8 * P, Color(1, 200 / 255.0, 120 / 255.0, 0.85), level * 0.8)
	for j in _fv.size():
		var f: Game.Fx = _fv[j]
		var q := _fq[j]
		var k := f.t / f.life
		match f.kind:
			"exp":
				_light(q.x, q.y - 4 * P, (20 + f.size * 16) * P, Color(1, 170 / 255.0, 80 / 255.0, 0.95), (1 - k) * (0.55 + level * 0.5))
			"ember":
				_light(q.x, q.y, 3 * P, Color(1, 170 / 255.0, 60 / 255.0), (1 - k) * (0.5 + level * 0.5))
			"fire":
				_light(q.x, q.y - 3 * P, 12 * P, Color(1, 140 / 255.0, 50 / 255.0, 0.8), 0.25 + level * 0.6)
			"flash":
				_light(q.x, q.y, (6 + f.size * 3) * P, Color(1, 230 / 255.0, 160 / 255.0, 0.9), 0.4 + level * 0.6)
	var ci := _layers[L_LIGHT]
	var vr := _view.grow(64)
	for j in _lc.size():
		var a := _lx[j * 4 + 3]
		if a <= 0.01:
			continue
		var x := _lx[j * 4]
		var y := _lx[j * 4 + 1]
		var r := _lx[j * 4 + 2]
		if x + r < vr.position.x or x - r > vr.end.x or y + r < vr.position.y or y - r > vr.end.y:
			continue
		var c := _lc[j]
		c.a *= minf(1.0, a)
		_glow(ci, x, y, r, c)


## shells and rockets
func _draw_shots() -> void:
	var g := game
	var ci := _layers[L_SHOT]
	for s in g.shots:
		var p := g.shot_pos(s)
		if not _visible_pt(p.x, p.y) and not _visible_pt(s.x0, s.y0):
			continue
		var q := _scr(p.x, p.y, p.z)
		match s.kind:
			"bullet", "flak":
				var pr := _shot_at(s, maxf(0, s.t - 0.03))
				var r := _scr(pr.x, pr.y, pr.z)
				_line(ci, r.x, r.y, q.x, q.y, Color("#ffb45a") if s.kind == "flak" else Color("#ffeaa0"))
			"shell":
				_rect(ci, q.x - 2, q.y, 4, 2, Color("#fff4c0"))
			"rocket", "mlrs":
				_rect(ci, q.x - 2, q.y - 1, 4, 3, Color("#e8e2d0"))
				_rect(ci, q.x, q.y, 2, 2, Color("#ffd060"))
			"missile":
				_rect(ci, q.x - 3, q.y - 1, 6, 3, Color("#d8dcd8"))
				_rect(ci, q.x - 1, q.y, 2, 2, Color("#ffe080"))
			"snipe":
				var pr := _shot_at(s, maxf(0, s.t - 0.05))
				var r := _scr(pr.x, pr.y, pr.z)
				_line(ci, r.x, r.y, q.x, q.y, Color(1, 1, 1, 0.7))
			"art":
				var gq := _scr(p.x, p.y)
				_rect(ci, gq.x - 2, gq.y, 4, 2, Color(0, 0, 0, 0.3))
				_rect(ci, q.x - 2, q.y - 2, 4, 4, Color("#2a2a28"))
				_rect(ci, q.x, q.y - 2, 2, 1, Color("#ffe6a0"))


## smoke, fire and explosions
func _draw_fx_high() -> void:
	var ci := _layers[L_HIGH]
	var ad := _layers[L_HIGH_ADD]
	for j in _fv.size():
		var f: Game.Fx = _fv[j]
		var ki := f.ki
		if ki == 1 or ki == 5 or ki == 6 or ki == 10 or ki == 7 or ki == 8:
			continue
		var q := _fq[j]
		var k := f.t / f.life
		match f.kind:
			"exp":
				var fr: Sheet = Art.explosion[mini(3, int(f.size))]
				var i := mini(fr.n - 1, floori(k * fr.n))
				if f.scale != 1.0:
					fr.draw_scaled(ci, i, q.x, q.y, f.scale)
				else:
					fr.draw(ci, i, q.x, q.y)
			"fire":
				Art.fire.draw(ci, int(floorf(f.t * 14 + f.x * 7)) % Art.fire.n, q.x, q.y)
			"flash":
				if f.size > 3:
					var r := Rng.js_round(f.size * 3 * P * (1 - k * 0.5))
					_glow(ad, q.x, q.y, r, Color(1, 240 / 255.0, 200 / 255.0, 1 - k))
				else:
					var r := Rng.js_round(f.size * P)
					_glow(ad, q.x, q.y, r * 2, Color(1, 236 / 255.0, 170 / 255.0, 1))
				_rect(ad, q.x - P, q.y - P, P * 2, P * 2, Color.WHITE)
			"ring":
				# the pressure wave
				var rr := int(Rng.js_round((3 + k * (10 + f.size * 15)) * P))
				_ring(ci, q.x, q.y, rr, Color(1, 240 / 255.0, 210 / 255.0, (1 - k) * 0.75))
				if rr > 4:
					var r2 := int(Rng.js_round(rr * 0.8))
					_ring(ci, q.x, q.y, r2, Color(180 / 255.0, 160 / 255.0, 124 / 255.0, (1 - k) * 0.5))
			"ember":
				_rect(ci, q.x, q.y, P, P * 2 if k < 0.3 else P, Color("#ffe070") if k < 0.5 else Color("#ff7a28"))
			"spark":
				var c := Color("#fff0a0") if k < 0.5 else Color("#ff9a40")
				_rect(ci, q.x + Rng.js_round(sin(f.t * 40) * 2 * P), q.y - Rng.js_round(k * 3 * P), P, P, c)
				_rect(ci, q.x - Rng.js_round(cos(f.t * 37) * 2 * P), q.y - Rng.js_round(k * 2 * P), P, P, c)


## health bars, rank stripes, who is aboard, a harvester's load
func _draw_bars() -> void:
	var g := game
	var ci := _layers[L_BARS]
	var hov: Variant = overlay.get("hover_ent")
	for e in g.ents:
		if e.dead or e.carried_by != null or e.inside != null or not _on_screen(e.x, e.y):
			continue
		var show: bool = e.selected or hov == e or (e.hp < e.max_hp and g.time - e.last_hit < 3)
		if not show or not shown(e):
			continue
		var k := maxf(0.0, e.hp / e.max_hp)
		var w := 0.0
		var x := 0.0
		var y := 0.0
		if e.is_b:
			var ba := Art.building(_ufac[e.owner], e.key)
			var s := _scr(e.x, e.y)
			w = e.w * 12 * P
			x = s.x - w / 2
			y = s.y - ba.body.ay + 2 * P
		else:
			var s := _scr(e.x, e.y, e.z)
			w = (10.0 if e.infantry else ((30.0 if e.urad > 0.9 else 22.0) if e.naval else 18.0)) * P
			x = s.x - w / 2
			y = s.y - (22.0 if e.infantry else (28.0 if e.air else ((40.0 if e.urad > 0.9 else 28.0) if e.naval else 22.0))) * P
		x = Rng.js_round(x)
		y = Rng.js_round(y)
		_rect(ci, x - 1, y - 1, w + 2, 6, C_BAR_BG)
		var bw := maxf(1, Rng.js_round(w * k))
		_rect(ci, x, y, bw, 4, Color("#5fd65a") if k > 0.6 else (Color("#e8c03a") if k > 0.3 else Color("#e2492f")))
		_rect(ci, x, y, bw, 1, Color(1, 1, 1, 0.25))
		# rank stripes
		if e.rank > 0:
			_chevrons(ci, x + w + 3, y - 2, e.rank)
		if e.is_b:
			continue
		# a landing ship shows who is aboard
		var tr := int(e.u.get("transport", 0))
		if tr and e.owner == 0:
			for i in tr:
				_rect(ci, x + i * 6, y + 6, 4, 4, C_GOLD if i < e.passengers.size() else C_BAR_BG)
		# a harvester shows its load
		if e.u.get("harvester", false) and e.owner == 0:
			_rect(ci, x - 1, y + 5, w + 2, 4, C_BAR_BG)
			_rect(ci, x, y + 6, Rng.js_round(w * e.cargo / g.harvest_load), 2, C_GOLD)


## rank stripes: one or two chevrons, a star for a veteran
func _chevrons(ci: RID, x: float, y: float, rank: int) -> void:
	var px := func(a: float, b: float, w: float, h: float, c: Color) -> void:
		RenderingServer.canvas_item_add_rect(ci, Rect2(x + a * P, y + b * P, w * P, h * P), c)
	px.call(-1, -1, 7, 7 if rank >= 3 else rank * 3 + 1, C_BAR_BG)
	var c := Color("#f0c840")
	if rank >= 3:
		px.call(2, 0, 1, 5, c)
		px.call(0, 2, 5, 1, c)
		px.call(1, 1, 3, 3, c)
		return
	for k in rank:
		var yy := k * 3
		px.call(0, yy, 1, 1, c)
		px.call(1, yy + 1, 3, 1, c)
		px.call(4, yy, 1, 1, c)


## the top of the roof (or tower) a flag flies from
func _roof_of(h: Game.Garrison) -> Vector2:
	var g := game
	if h.b != null:
		return Art.top_of(Art.building(_ufac[h.b.owner], h.b.key).body)
	var st: Variant = g.map.tile_statics[g.map.idx(h.tx, h.ty)]
	if st is Array:
		for s in st:
			var k: String = s["kind"]
			if k == "house" or k == "timber" or k == "church" or k == "barn":
				var arr: Array = Art.statics[k]
				return Art.top_of(arr[int(s["v"]) % arr.size()][0])
	return Vector2(24 * P, 0)


## flags over the houses that are held, and how full they are
func _draw_garrisons() -> void:
	var g := game
	var ci := _layers[L_BARS]
	var N := g.map.N
	var hov: Variant = overlay.get("hover_g")
	for h in g.garrisons:
		if not _on_screen(h.x, h.y):
			continue
		var fg := g.fog[h.ty * N + h.tx]
		var seen := fg == 2
		var mine_sel := false
		for u in h.occ:
			if u.selected:
				mine_sel = true
				break
		var hover: bool = hov == h
		if (mine_sel or hover) and fg:
			_footprint(ci, h.tx, h.ty, h.w, h.h, C_SEL if mine_sel else (C_FOE if h.owner > 0 and not h.occ.is_empty() else C_HOVER), 1.0 if mine_sel else 0.7)
		if h.occ.is_empty() or h.owner < 0 or (h.owner != 0 and not seen):
			continue
		var roof := _roof_of(h)
		var base := _scr(h.x, h.y)
		base.x += roof.y
		var top := base.y - roof.x + 3 * P
		var team: Array = Art.TEAM.get(_ufac[h.owner], Art.TEAM["nato"])
		# the pole and a flag in the wind
		_rect(ci, base.x, top - 14 * P, P, 14 * P, Color("#1a1c18"))
		var wave := int(floorf(g.time * 4 + h.id)) % 2
		for k in 7:
			var dy := 0.0 if (k + wave) % 4 < 2 else P
			_rect(ci, base.x + P + k * P, top - 14 * P + dy, P, 4 * P, team[1] if k < 1 else team[0])
			_rect(ci, base.x + P + k * P, top - 14 * P + dy, P, 1, team[2])
		# our own: how many are inside
		if h.owner == 0:
			var w := h.cap * 4 * P - P
			var x0 := base.x - Rng.js_round(w / 2) + 4 * P
			_rect(ci, x0 - 1, top - 20 * P - 1, w + 2, 3 * P + 2, C_BAR_BG)
			for i in h.cap:
				_rect(ci, x0 + i * 4 * P, top - 20 * P, 3 * P, 3 * P, C_GOLD if i < h.occ.size() else Color("#3a3e34"))
			# the weakest of them, as a bar
			var k := 1.0
			for u in h.occ:
				k = minf(k, u.hp / u.max_hp)
			if k < 1:
				_rect(ci, x0 - 1, top - 16 * P, w + 2, 2 * P + 1, C_BAR_BG)
				_rect(ci, x0, top - 16 * P + 1, maxf(1, Rng.js_round(w * k)), 2 * P - 1, Color("#5fd65a") if k > 0.6 else (Color("#e8c03a") if k > 0.3 else Color("#e2492f")))


## fog of war: one pixel per tile, laid over the ground through the projection, smoothly filtered
func _draw_fog() -> void:
	var g := game
	var N := g.map.N
	if g.fog_dirty:
		var b := _fog_bytes
		for i in N * N:
			var f := g.fog[i]
			var j := i * 4
			b[j] = 11
			b[j + 1] = 13
			b[j + 2] = 10
			b[j + 3] = 0 if f == 2 else (120 if f == 1 else 255)
		_fog_img.set_data(N, N, false, Image.FORMAT_RGBA8, b)
		_fog_tex.update(_fog_img)
		g.fog_dirty = false
	var ci := _layers[L_FOG]
	RenderingServer.canvas_item_add_set_transform(ci, Transform2D(Vector2(32, 16), Vector2(-32, 16), Vector2.ZERO))
	RenderingServer.canvas_item_add_texture_rect(ci, Rect2(0, 0, N, N), _fog_tex.get_rid())
	RenderingServer.canvas_item_add_set_transform(ci, Transform2D.IDENTITY)


## rally points, where a move order went, a building being placed, the selection box
func _draw_overlay() -> void:
	var g := game
	var ci := _layers[L_OVER]
	var green := Color("#9cff8a")
	for e in g.ents:
		if not e.selected or not e.is_b or e.rally == null or e.owner != 0:
			continue
		var a := _scr(e.x, e.y)
		var rp: Vector2 = e.rally
		var b := _scr(rp.x, rp.y)
		_dashed(ci, a, b, green)
		_rect(ci, b.x - 1, b.y - 6 * P, P, 6 * P, green)
		_rect(ci, b.x, b.y - 6 * P, 3 * P, 2 * P, green)
	var mm: Variant = overlay.get("move_mark")
	if mm is Dictionary:
		var k := minf(1.0, (g.time - float(mm["t"])) / 0.5)
		if k < 1:
			var s := _scr(float(mm["x"]), float(mm["y"]))
			var r := int(Rng.js_round((7 * (1 - k) + 2) * P))
			_ring(ci, s.x, s.y, r, C_FOE if mm.get("attack", false) else C_SEL)
	var pl: Variant = overlay.get("place")
	if pl is Dictionary and g.bdefs.has(pl["key"]):
		var def: Dictionary = g.bdefs[pl["key"]]
		var dw := int(def["w"])
		var dh := int(def["h"])
		var tx := int(pl["tx"])
		var ty := int(pl["ty"])
		var ba := Art.building(g.me.faction, pl["key"])
		var s := _scr(tx + dw / 2.0, ty + dh / 2.0)
		ba.body.draw(ci, 0, s.x, s.y, Color(1, 1, 1, 0.55))
		for y in range(ty, ty + dh):
			for x in range(tx, tx + dw):
				var ok: bool = pl.get("ok", false) and g.map.buildable(x, y)
				var pts := PackedVector2Array([_scr(x, y), _scr(x + 1, y), _scr(x + 1, y + 1), _scr(x, y + 1)])
				RenderingServer.canvas_item_add_polygon(ci, pts, PackedColorArray([Color(90 / 255.0, 1, 110 / 255.0, 0.30) if ok else Color(1, 70 / 255.0, 50 / 255.0, 0.45)]))
	var bx: Variant = overlay.get("box")
	if bx is Rect2:
		var r: Rect2 = bx.abs()
		var p0 := screen_to_px(r.position).round()
		var p1 := screen_to_px(r.end).round()
		var w := p1.x - p0.x
		var h := p1.y - p0.y
		_rect(ci, p0.x, p0.y, w, h, Color(120 / 255.0, 1, 110 / 255.0, 0.12))
		_rect(ci, p0.x, p0.y, w, 1, C_SEL)
		_rect(ci, p0.x, p0.y + h, w + 1, 1, C_SEL)
		_rect(ci, p0.x, p0.y, 1, h, C_SEL)
		_rect(ci, p0.x + w, p0.y, 1, h, C_SEL)


## a dashed line of 2 × 2 squares, 8 on and 8 off
func _dashed(ci: RID, a: Vector2, b: Vector2, c: Color) -> void:
	var n := maxf(maxf(absf(b.x - a.x), absf(b.y - a.y)), 1.0)
	var i := 0
	while i <= n:
		var j := minf(i + 7, n)
		var p := a + (b - a) * (i / n)
		var q := a + (b - a) * (j / n)
		_line(ci, roundf(p.x), roundf(p.y), roundf(q.x), roundf(q.y), c, 2)
		i += 16
