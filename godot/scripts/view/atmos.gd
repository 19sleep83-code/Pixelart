class_name Atmos
extends RefCounted
## The weather and the light over the battlefield (port of src/game/atmos.ts): glinting water and
## surf on the shores, cloud shadows drifting over the land, the colour of the hour (day, dusk,
## night) with lights that glow in the dark, rain with the odd flash of lightning.
##
## The glints, the swell and the surf are three MultiMeshes (every point of the whole map, made
## once) whose shader works out from the game time what the prototype drew pixel by pixel.

const P := 2.0
const S := 128

const WATER_SHADER := """
shader_type canvas_item;
render_mode unshaded;
uniform float t;
uniform int kind;
uniform vec4 col : source_color;
varying flat vec4 cd;
varying vec2 lp;
void vertex() {
	cd = INSTANCE_CUSTOM;
	lp = VERTEX;
	if (kind == 1) {
		float k = fract(t * 0.25 + cd.x);
		VERTEX += vec2(floor(41.6 * k + 0.5), floor(11.2 * k + 0.5));
	}
}
void fragment() {
	vec2 p = floor(lp);
	float a = 0.0;
	if (kind == 0) {
		// glints that come and go
		float s = sin(t * 1.6 + cd.x);
		float lx = p.x - 2.0;
		float ly = p.y - 1.0;
		if (s > 0.94) {
			if ((ly == 0.0 && lx >= -2.0 && lx < 4.0) || (ly == -1.0 && lx >= 0.0 && lx < 2.0)) a = 1.0;
		} else if (s >= 0.82) {
			if (ly == 0.0 && lx >= 0.0 && lx < 3.0) a = 1.0;
		}
	} else if (kind == 1) {
		// slow swell on open water
		float k = fract(t * 0.25 + cd.x);
		if ((p.y == 0.0 && p.x < 8.0) || (p.y == 1.0 && p.x >= 2.0 && p.x < 6.0)) a = sin(k * PI) * 0.5;
	} else {
		// the surf
		float s = 0.5 + 0.5 * sin(t * 1.9 + cd.x);
		if (s >= 0.35 && p.y == (s > 0.8 ? 2.0 : 0.0)) a = s * 0.85;
	}
	if (a <= 0.001) discard;
	COLOR = vec4(col.rgb, a);
}
"""

var map: GameMap
var tod: String
var weather: String
var cloud: ImageTexture
var water_nodes: Array[MultiMeshInstance2D] = []
var _mats: Array[ShaderMaterial] = []
## rain drops: x, y (relative to the view's corner), speed, length
var _drops := PackedFloat32Array()
var _flash := 0.0
var _next_bolt := 6.0

static var _cloud_noise := PackedFloat32Array()


func _init(m: GameMap, tod_: String, weather_: String) -> void:
	map = m
	tod = tod_
	weather = weather_
	_make_water()
	_make_cloud()


func _land(x: int, y: int) -> bool:
	if not map.in_map(x, y):
		return false
	var t := map.ter[map.idx(x, y)]
	return t != GameMap.WATER and t != GameMap.BRIDGE


func _make_water() -> void:
	var N := map.N
	var glints := []  # [pos, phase]
	var swell := []
	var foam := []
	for y in N:
		for x in N:
			var i := map.idx(x, y)
			if map.ter[i] != GameMap.WATER:
				continue
			for k in 2:
				var ph := Rng.hash2(x, y, k + 7) * 6.283
				var u := Rng.hash2(x, y, k + 11)
				var v := Rng.hash2(y, x, k + 13)
				var wx := x + u
				var wy := y + v
				var sx := Rng.js_round((wx - wy) * 32.0)
				var sy := Rng.js_round((wx + wy) * 16.0)
				glints.append([Vector2(sx - 2, sy - 1), ph])
			if map.depth[i] >= 3 and Rng.hash2(x, y, 3) < 0.35:
				var ph2 := Rng.hash2(x, y, 5)
				swell.append([Vector2((x - y - 0.5) * 32.0, (x + y + 0.5) * 16.0), ph2])
			var pts := PackedFloat32Array()
			if _land(x - 1, y): _edge(pts, x, y, x, y + 1, 1, 0)
			if _land(x + 1, y): _edge(pts, x + 1, y, x + 1, y + 1, -1, 0)
			if _land(x, y - 1): _edge(pts, x, y, x + 1, y, 0, 1)
			if _land(x, y + 1): _edge(pts, x, y + 1, x + 1, y + 1, 0, -1)
			for p in range(0, pts.size(), 2):
				var ph3 := Rng.hash2(i, p, 9) * 6.283 + (pts[p] + pts[p + 1]) * 0.02
				foam.append([Vector2(Rng.js_round(pts[p]), Rng.js_round(pts[p + 1])), ph3])
	var night := tod == "night"
	var glint_col := Color("#6d86a8") if night else Color("#a9d0e0")
	var foam_col := Color("#9fb0c4") if night else Color("#f4f8f4")
	water_nodes.append(_multimesh(glints, Vector2(6, 2), 0, glint_col))
	water_nodes.append(_multimesh(swell, Vector2(8, 2), 1, glint_col))
	water_nodes.append(_multimesh(foam, Vector2(4, 3), 2, foam_col))


func _edge(pts: PackedFloat32Array, ax: float, ay: float, bx: float, by: float, nx: float, ny: float) -> void:
	for k in 10:
		var t := (k + 0.5) / 10.0
		# the prototype keeps these in a Float32Array
		var wx := ax + (bx - ax) * t + nx * 0.07
		var wy := ay + (by - ay) * t + ny * 0.07
		pts.append((wx - wy) * 32.0)
		pts.append((wx + wy) * 16.0)


func _multimesh(items: Array, size: Vector2, kind: int, col: Color) -> MultiMeshInstance2D:
	var mesh := ArrayMesh.new()
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = PackedVector2Array([Vector2.ZERO, Vector2(size.x, 0), size, Vector2.ZERO, size, Vector2(0, size.y)])
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_2D
	mm.use_custom_data = true
	mm.mesh = mesh
	mm.instance_count = items.size()
	for i in items.size():
		mm.set_instance_transform_2d(i, Transform2D(0.0, items[i][0]))
		mm.set_instance_custom_data(i, Color(items[i][1], 0, 0, 0))
	var N := map.N
	mm.custom_aabb = AABB(Vector3(-N * 32.0 - 64, -64, -1), Vector3(N * 64.0 + 128, N * 32.0 + 128, 2))
	var node := MultiMeshInstance2D.new()
	node.multimesh = mm
	var mat := ShaderMaterial.new()
	var sh := Shader.new()
	sh.code = WATER_SHADER
	mat.shader = sh
	mat.set_shader_parameter("kind", kind)
	mat.set_shader_parameter("col", col)
	mat.set_shader_parameter("t", 0.0)
	node.material = mat
	_mats.append(mat)
	return node


## the water moves with the game time
func water(t: float) -> void:
	for m in _mats:
		m.set_shader_parameter("t", t)


## a tileable sheet of soft cloud shadow (128 px, drawn ten times as wide and five times as high)
func _make_cloud() -> void:
	if _cloud_noise.is_empty():
		_cloud_noise = _noise_sheet()
	var cover := 0.66 if weather == "clear" else (0.5 if weather == "clouds" else 0.42)
	var img := Image.create(S, S, false, Image.FORMAT_RGBA8)
	for y in S:
		for x in S:
			var a := clampf((_cloud_noise[y * S + x] - cover) * 6.0, 0.0, 1.0)
			img.set_pixel(x, y, Color8(0x0d, 0x12, 0x0f, int(Rng.js_round(a * 70.0))))
	cloud = ImageTexture.create_from_image(img)


## fbm(x, y, 40, 77, 3) blended with its wrapped copies (atmos.ts), with the noise lattice cached
static func _noise_sheet() -> PackedFloat32Array:
	# fbm over x, y in [-S, S)
	var W := S * 2
	var f := PackedFloat32Array()
	f.resize(W * W)
	var amp := 1.0
	var norm := 0.0
	var cell := 40.0
	for o in 3:
		var seed_ := 77 + o * 31
		var i0 := int(floorf(-S / cell))
		var i1 := int(floorf((S - 1) / cell)) + 1
		var L := i1 - i0 + 1
		var lat := PackedFloat32Array()
		lat.resize(L * L)
		for j in L:
			for i in L:
				lat[j * L + i] = Rng.hash2(i + i0, j + i0, seed_)
		for yy in W:
			var fy := (yy - S) / cell
			var iyf := floorf(fy)
			var ty := fy - iyf
			var sy := ty * ty * (3.0 - 2.0 * ty)
			var row := (int(iyf) - i0) * L
			for xx in W:
				var fx := (xx - S) / cell
				var ixf := floorf(fx)
				var tx := fx - ixf
				var sx := tx * tx * (3.0 - 2.0 * tx)
				var k := row + int(ixf) - i0
				var a := lat[k]
				var b := lat[k + 1]
				var c := lat[k + L]
				var d := lat[k + L + 1]
				f[yy * W + xx] += (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * amp
		norm += amp
		amp *= 0.5
		cell *= 0.5
	var out := PackedFloat32Array()
	out.resize(S * S)
	for y in S:
		for x in S:
			var u := float(x) / S
			var v := float(y) / S
			var n := f[(y + S) * W + x + S] * (1 - u) * (1 - v) + f[(y + S) * W + x] * u * (1 - v) + f[y * W + x + S] * (1 - u) * v + f[y * W + x] * u * v
			out[y * S + x] = n / norm
	return out


## shadows of clouds drifting with the wind: where the tiles of the sheet lie (world pixels)
func clouds(ci: RID, view: Rect2, t: float) -> void:
	var SW := 640.0 * P
	var SH := 320.0 * P
	var ox := fposmod(t * 7.0, SW)
	var oy := fposmod(t * 2.5, SH)
	var x0 := floorf((view.position.x - ox) / SW) * SW + ox
	var y0 := floorf((view.position.y - oy) / SH) * SH + oy
	var y := y0
	var rid := cloud.get_rid()
	while y < view.end.y:
		var x := x0
		while x < view.end.x:
			RenderingServer.canvas_item_add_texture_rect_region(ci, Rect2(roundf(x), roundf(y), SW, SH), rid, Rect2(0, 0, S, S))
			x += SW
		y += SH


## the colour of the hour and of the weather, multiplied over everything that does not glow
## (null on a clear day)
func grade() -> Variant:
	var c := Color.WHITE
	var any := false
	if tod == "night":
		c *= Color("#6070a0") if weather == "rain" else Color("#526294")
		any = true
	elif tod == "dusk":
		c *= Color("#f0b98c") * Color("#efe4ee")
		any = true
	if weather == "rain":
		c *= Color("#c4ccd4") if tod == "night" else Color("#a8b2ba")
		any = true
	c.a = 1.0
	return c if any else null


## how strongly lights show at this hour
var light_level: float:
	get:
		return 1.0 if tod == "night" else (0.45 if tod == "dusk" else (0.25 if weather == "rain" else 0.0))


## rain streaks, splashes and lightning, over the view (world pixels)
func rain(ci: RID, view: Rect2, dt: float) -> void:
	if weather != "rain":
		return
	var W := view.size.x
	var H := view.size.y
	var want := int(Rng.js_round((W * H) / (900.0 * P * P)))
	while _drops.size() / 4 < want:
		_drops.append(randf() * W)
		_drops.append(randf() * H)
		_drops.append((160.0 + randf() * 90.0) * P)
		_drops.append((4 + floorf(randf() * 4)) * P)
	if _drops.size() / 4 > want:
		_drops.resize(want * 4)
	var col := Color(150 / 255.0, 170 / 255.0, 200 / 255.0, 0.45) if tod == "night" else Color(210 / 255.0, 225 / 255.0, 240 / 255.0, 0.55)
	var o := view.position
	for j in range(0, _drops.size(), 4):
		var v := _drops[j + 2]
		_drops[j + 1] += v * dt
		_drops[j] -= v * dt * 0.25
		var x := _drops[j]
		var y := _drops[j + 1]
		if y > H or x < 0:
			# a splash where it lands, then back to the top
			RenderingServer.canvas_item_add_rect(ci, Rect2(o.x + Rng.js_round(x) - P, o.y + Rng.js_round(minf(y, H - 1)), 3 * P, 1), col)
			_drops[j + 1] = -randf() * 20 * P
			_drops[j] = randf() * (W + 60 * P)
			x = _drops[j]
			y = _drops[j + 1]
		var l := _drops[j + 3]
		var k := 0.0
		while k < l:
			RenderingServer.canvas_item_add_rect(ci, Rect2(o.x + Rng.js_round(x + k * 0.25), o.y + Rng.js_round(y - k - 3), 1, 4), col)
			k += 4
	# lightning
	_next_bolt -= dt
	if _next_bolt <= 0:
		_next_bolt = 7 + randf() * 14
		_flash = 1
	if _flash > 0:
		var k := _flash if (_flash > 0.7 or (_flash > 0.3 and _flash < 0.45)) else _flash * 0.3
		RenderingServer.canvas_item_add_rect(ci, view, Color(230 / 255.0, 235 / 255.0, 1.0, k * 0.45))
		_flash -= dt * 2.2
