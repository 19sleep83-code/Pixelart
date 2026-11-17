class_name Terrain
extends Node2D
## The ground as two tile layers: the ground itself (meadows, fields with hedges, woods, earth, ore,
## sand, water by depth, every shape of shore) and the roads on top. Tiles and the rules for picking
## them come from the exporter (manifest.terrain, README "Gelände"). Marks left by the fighting and
## the shadows of trees and houses are drawn above the ground.

const D8 := [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1), Vector2i(1, 1), Vector2i(-1, 1), Vector2i(1, -1), Vector2i(-1, -1)]

var map: GameMap
var ground: TileMapLayer
var roads: TileMapLayer
var marks: Node2D
var _coords := {}  # tile key -> atlas coords
var _source := 0
## the shadows of trees and houses and the marks of the fighting, in pieces of CHUNK × CHUNK tiles
const CHUNK := 16
var _shadow_items: Array[RID] = []
var _mark_items: Array[RID] = []
var _mark_list: Array = []  # per chunk: Array of [Sheet, frame, Vector2]
var _cn := 1


func setup(m: GameMap) -> void:
	map = m
	var t: Dictionary = Data.manifest.get("terrain", {})
	var tex := Data.tex(t.get("atlas", ""))
	for info in t.get("tiles", []):
		_coords[info["key"]] = Vector2i(int(info["col"]), int(info["row"]))
	var ts := TileSet.new()
	ts.tile_shape = TileSet.TILE_SHAPE_ISOMETRIC
	ts.tile_layout = TileSet.TILE_LAYOUT_DIAMOND_DOWN
	ts.tile_size = Vector2i(Data.TW, Data.TH)
	var src := TileSetAtlasSource.new()
	src.texture = tex
	src.texture_region_size = Vector2i(Data.TW, Data.TH)
	for c in _coords.values():
		if not src.has_tile(c):
			src.create_tile(c)
	_source = ts.add_source(src)
	ground = TileMapLayer.new()
	ground.tile_set = ts
	roads = TileMapLayer.new()
	roads.tile_set = ts
	# tile (0, 0) has its top corner at the origin, like the prototype's projection
	ground.position = Vector2(0, Data.TH / 2.0) - ground.map_to_local(Vector2i.ZERO)
	roads.position = ground.position
	add_child(ground)
	add_child(roads)
	marks = Node2D.new()
	add_child(marks)
	repaint_all()
	_bake_marks()


func _notification(what: int) -> void:
	if what != NOTIFICATION_PREDELETE:
		return
	for r in _shadow_items + _mark_items:
		RenderingServer.free_rid(r)
	_shadow_items.clear()
	_mark_items.clear()


func _chunk_of(x: float, y: float) -> int:
	var cx := clampi(int(floorf(x / CHUNK)), 0, _cn - 1)
	var cy := clampi(int(floorf(y / CHUNK)), 0, _cn - 1)
	return cy * _cn + cx


## the shadows of trees and houses lie on the ground (baked once); marks of the fighting go above them
func _bake_marks() -> void:
	Art.load_all()
	_cn = int(ceilf(map.N / float(CHUNK)))
	var parent := marks.get_canvas_item()
	for layer in 2:
		for c in _cn * _cn:
			var ci := RenderingServer.canvas_item_create()
			RenderingServer.canvas_item_set_parent(ci, parent)
			RenderingServer.canvas_item_set_draw_index(ci, layer * _cn * _cn + c)
			if layer == 0:
				_shadow_items.append(ci)
			else:
				_mark_items.append(ci)
				_mark_list.append([])
	for s in map.statics:
		var arr: Array = Art.statics.get(s["kind"], [])
		if arr.is_empty():
			continue
		var sh: Sheet = arr[int(s["v"]) % arr.size()][1]
		if sh == null:
			continue
		var x := float(s["x"])
		var y := float(s["y"])
		sh.draw(_shadow_items[_chunk_of(x, y)], 0, Rng.js_round((x - y) * 32.0), Rng.js_round((x + y) * 16.0))


## paint a mark onto the ground at a world position (tiles); it stays
func stamp(kind: String, size: int, x: float, y: float) -> void:
	var sh: Sheet = Art.scorch if kind == "scorch" else Art.rubble
	if sh == null:
		return
	var fr := clampi(size if kind == "scorch" else maxi(0, size - 1), 0, sh.n - 1)
	var c := _chunk_of(x, y)
	var pos := Vector2(Rng.js_round((x - y) * 32.0), Rng.js_round((x + y) * 16.0))
	var list: Array = _mark_list[c]
	list.append([sh, fr, pos])
	var ci := _mark_items[c]
	if list.size() > 400:
		# too many on one piece of ground: forget the oldest
		list = list.slice(list.size() - 300)
		_mark_list[c] = list
		RenderingServer.canvas_item_clear(ci)
		for m in list:
			m[0].draw(ci, m[1], m[2].x, m[2].y)
	else:
		sh.draw(ci, fr, pos.x, pos.y)


func repaint_all() -> void:
	for y in map.N:
		for x in map.N:
			repaint_tile(x, y)


## put the right tile down (ore used up, a bridge blown …)
func repaint_tile(x: int, y: int) -> void:
	var key := tile_key(x, y)
	var c: Vector2i = _coords.get(key, _coords.get("grass/s0/h0/v0", Vector2i.ZERO))
	ground.set_cell(Vector2i(x, y), _source, c)
	var i := map.idx(x, y)
	if map.ter[i] == GameMap.ROAD:
		var rk := "road/r%d/v%d" % [map.road[i], _var(x, y) % 2]
		roads.set_cell(Vector2i(x, y), _source, _coords.get(rk, c))
	else:
		roads.erase_cell(Vector2i(x, y))


func _var(x: int, y: int) -> int:
	return int(Rng.hash2(x, y, 41) * 4.0)


func _is_water(x: int, y: int) -> bool:
	if not map.in_map(x, y):
		return false
	var t := map.ter[map.idx(x, y)]
	return t == GameMap.WATER or t == GameMap.BRIDGE


## which tile a field gets (the rules in the exporter's README)
func tile_key(x: int, y: int) -> String:
	var i := map.idx(x, y)
	var t: int = map.ter[i]
	var v := _var(x, y)
	if t == GameMap.BRIDGE:
		return "bridge/r%d" % (3 if map.road[i] & 3 else 12)
	var w := _is_water(x, y)
	var k := 0
	for d in 8:
		var n: Vector2i = D8[d]
		if map.in_map(x + n.x, y + n.y) and _is_water(x + n.x, y + n.y) != w:
			k |= 1 << d
	if k & (1 | 4): k &= ~16
	if k & (2 | 4): k &= ~32
	if k & (1 | 8): k &= ~64
	if k & (2 | 8): k &= ~128
	if k:
		if w:
			var sandy := false
			for d in 8:
				var n: Vector2i = D8[d]
				if map.in_map(x + n.x, y + n.y) and map.ter[map.idx(x + n.x, y + n.y)] == GameMap.SAND:
					sandy = true
			return "shore/water-%s/m%d" % ["sand" if sandy else "grass", k]
		return "shore/%s/m%d" % ["sand" if t == GameMap.SAND else "grass", k]
	var h := 0
	if x > 0 and map.parcel[i - 1] != map.parcel[i]: h |= 1
	if y > 0 and map.parcel[i - map.N] != map.parcel[i]: h |= 2
	match t:
		GameMap.GRASS:
			return "grass/s%d/h%d/v%d" % [map.variant[i] % 3, h, v]
		GameMap.FIELD:
			return "field/c%d/d%d/h%d/v%d" % [map.variant[i] & 7, (map.variant[i] >> 3) & 1, h, v % 2]
		GameMap.WATER:
			var dep: int = map.depth[i]
			return "water/d%d/v%d" % [1 if dep < 3 else (3 if dep < 6 else 6), v]
		GameMap.ROAD:
			return "grass/s%d/h0/v%d" % [map.variant[i] % 3, v]
		GameMap.FOREST:
			return "forest/v%d" % v
		GameMap.DIRT:
			return "dirt/v%d" % v
		GameMap.ORE:
			return "ore/v%d" % v
		GameMap.SAND:
			return "sand/v%d" % v
	return "grass/s0/h0/v0"
