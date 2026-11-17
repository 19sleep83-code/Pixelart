class_name GameMap
extends RefCounted
## The battlefield: a patchwork of fields and meadows, woods, a river with bridges, country roads,
## villages with red roofs, and fields of ore to fight over. Generated from a seed.
##
## Port of src/game/map.ts. The order of random numbers and every floating-point step are kept
## as in the prototype, so a seed gives exactly the same map.

const GRASS := 0
const FIELD := 1
const FOREST := 2
const WATER := 3
const ROAD := 4
const ORE := 5
const BRIDGE := 6
const DIRT := 7
const SAND := 8

## same as rules.json `orePerTile` (ORE_PER_TILE in the prototype)
const ORE_PER_TILE := 900

const DIRS4: Array[Vector2i] = [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]

var N: int
@warning_ignore("shadowed_global_identifier")
var seed: int
var ter: PackedByteArray
## crop of a field (0-4) or shade of a meadow; bit 3: furrows run along y
var variant: PackedByteArray
var parcel: PackedInt32Array
var ore: PackedInt32Array
## trees, houses and water: nothing on the ground goes there
var block: PackedByteArray
## the building standing on a tile (entity id)
var bld: PackedInt32Array
## road links to the four neighbours: 1 +x, 2 -x, 4 +y, 8 -y
var road: PackedByteArray
## Dictionaries {kind: String, v: int, x: float, y: float}
var statics: Array = []
## for each tile null or an Array of statics
var tile_statics: Array = []
var starts: Array[Vector2i] = []
var type: String = "land"
## for each water tile: how many tiles to the nearest land (capped)
var depth: PackedByteArray


func _init(n_: int = 96, seed_: int = 0) -> void:
	N = n_
	seed = seed_
	var n := N * N
	ter = PackedByteArray()
	ter.resize(n)
	variant = PackedByteArray()
	variant.resize(n)
	parcel = PackedInt32Array()
	parcel.resize(n)
	ore = PackedInt32Array()
	ore.resize(n)
	block = PackedByteArray()
	block.resize(n)
	bld = PackedInt32Array()
	bld.resize(n)
	road = PackedByteArray()
	road.resize(n)
	tile_statics = []
	tile_statics.resize(n)
	depth = PackedByteArray()
	depth.resize(n)


## water a boat can use
static func nav_ter(t: int) -> bool:
	return t == WATER or t == BRIDGE


## can a boat be on this tile
func nav(x: int, y: int) -> bool:
	if x < 0 or y < 0 or x >= N or y >= N:
		return false
	return nav_ter(ter[y * N + x])


func nav_i(i: int) -> bool:
	return nav_ter(ter[i])


## distance of every water tile from the shore, for the colour of the sea
func measure_depth() -> void:
	var q := PackedInt32Array()
	depth.fill(255)
	for i in N * N:
		if ter[i] != WATER:
			depth[i] = 0
			q.push_back(i)
	var k := 0
	while k < q.size():
		var i := q[k]
		var x := i % N
		@warning_ignore("integer_division")
		var y := i / N
		for d in DIRS4:
			var nx := x + d.x
			var ny := y + d.y
			if nx < 0 or ny < 0 or nx >= N or ny >= N:
				continue
			var j := ny * N + nx
			if depth[j] == 255:
				depth[j] = mini(250, depth[i] + 1)
				q.push_back(j)
		k += 1


func in_map(x: int, y: int) -> bool:
	return x >= 0 and y >= 0 and x < N and y < N


func idx(x: int, y: int) -> int:
	return y * N + x


## can a ground unit stand on this tile
func walk(x: int, y: int) -> bool:
	if x < 0 or y < 0 or x >= N or y >= N:
		return false
	var i := y * N + x
	return block[i] == 0 and bld[i] == 0


func walk_i(i: int) -> bool:
	return block[i] == 0 and bld[i] == 0


func buildable(x: int, y: int) -> bool:
	if not in_map(x, y):
		return false
	var i := idx(x, y)
	var t := ter[i]
	return block[i] == 0 and bld[i] == 0 and (t == GRASS or t == FIELD or t == ROAD or t == DIRT or t == SAND)


func add_static(s: Dictionary) -> void:
	var tx := floori(s.x)
	var ty := floori(s.y)
	var i := idx(tx, ty)
	statics.append(s)
	if tile_statics[i] == null:
		tile_statics[i] = []
	tile_statics[i].append(s)


# ─────────────────────────────────────────────────────────── generation

static func _split_parcels(m: GameMap, r: Rng.Mulberry) -> void:
	var id := 1
	var rects: Array[PackedInt32Array] = [PackedInt32Array([0, 0, m.N, m.N])]
	while not rects.is_empty():
		var rc: PackedInt32Array = rects.pop_back()
		var x := rc[0]
		var y := rc[1]
		var w := rc[2]
		var h := rc[3]
		var big := maxi(w, h)
		if big > 12 or (big > 6 and r.next() < 0.55):
			if w >= h:
				var s := floori(w * (0.35 + r.next() * 0.3))
				rects.append(PackedInt32Array([x, y, s, h]))
				rects.append(PackedInt32Array([x + s, y, w - s, h]))
			else:
				var s := floori(h * (0.35 + r.next() * 0.3))
				rects.append(PackedInt32Array([x, y, w, s]))
				rects.append(PackedInt32Array([x, y + s, w, h - s]))
			continue
		var k := r.next()
		var along := 8 if r.next() < 0.5 else 0
		for yy in range(y, y + h):
			for xx in range(x, x + w):
				var i := m.idx(xx, yy)
				m.parcel[i] = id
				if k < 0.1:
					m.ter[i] = FOREST
				elif k < 0.62:
					m.ter[i] = FIELD
					m.variant[i] = (floori(((k - 0.1) / 0.52) * 5) % 5) | along
				else:
					m.ter[i] = GRASS
					m.variant[i] = floori(r.next() * 3)
		id += 1


## a road between two points, found on a cost map that prefers fields and old roads to woods and water
static func _road_path(m: GameMap, ax: int, ay: int, bx: int, by: int) -> PackedInt32Array:
	var N_ := m.N
	var n := N_ * N_
	var ter_ := m.ter
	var block_ := m.block
	var seed_ := m.seed
	# the cost of entering each tile does not change during the search, so work it out once
	var cost := PackedFloat64Array()
	cost.resize(n)
	for i in n:
		var t := ter_[i]
		if t == ROAD or t == BRIDGE:
			cost[i] = 0.35
		elif t == WATER:
			cost[i] = 14.0
		elif t == FOREST:
			cost[i] = 3.0
		elif t == ORE:
			cost[i] = 6.0
		elif block_[i] != 0:
			cost[i] = 30.0
		else:
			cost[i] = 1.0 + Rng.hash2(i, 3, seed_) * 0.4
	var g := PackedFloat32Array()
	g.resize(n)
	g.fill(1e9)
	var came := PackedInt32Array()
	came.resize(n)
	came.fill(-1)
	var open := PackedInt32Array()
	var start := m.idx(ax, ay)
	var goal := m.idx(bx, by)
	g[start] = 0.0
	open.push_back(start)
	var f := PackedFloat32Array()
	f.resize(n)
	f[start] = absi(ax - bx) + absi(ay - by)
	var closed := PackedByteArray()
	closed.resize(n)
	var dxs := PackedInt32Array([1, -1, 0, 0])
	var dys := PackedInt32Array([0, 0, 1, -1])
	while open.size() > 0:
		var len_ := open.size()
		var bi := 0
		var bf := f[open[0]]
		for k in range(1, len_):
			var fk := f[open[k]]
			if fk < bf:
				bf = fk
				bi = k
		var cur := open[bi]
		open[bi] = open[len_ - 1]
		open.resize(len_ - 1)
		if cur == goal:
			break
		if closed[cur] != 0:
			continue
		closed[cur] = 1
		var cx := cur % N_
		@warning_ignore("integer_division")
		var cy := cur / N_
		for d in 4:
			var nx := cx + dxs[d]
			var ny := cy + dys[d]
			if nx < 0 or ny < 0 or nx >= N_ or ny >= N_:
				continue
			var ni := ny * N_ + nx
			# bridges cross the river straight
			var turn := 40.0 if came[cur] >= 0 and ter_[cur] == WATER and (cur - came[cur]) != (ni - cur) else 0.0
			var ng: float = g[cur] + cost[ni] + turn
			if ng < g[ni]:
				g[ni] = ng
				came[ni] = cur
				f[ni] = ng + (absi(nx - bx) + absi(ny - by)) * 0.4
				open.push_back(ni)
	var path := PackedInt32Array()
	var c := goal
	while c >= 0:
		path.push_back(c)
		if c == start:
			break
		c = came[c]
	path.reverse()
	return path


static func _lay_road(m: GameMap, path: PackedInt32Array) -> void:
	var N_ := m.N
	var L := path.size()
	for k in L:
		var i := path[k]
		m.ter[i] = BRIDGE if m.ter[i] == WATER or m.ter[i] == BRIDGE else ROAD
		m.block[i] = 0
		m.ore[i] = 0
		for kk in [k - 1, k + 1]:
			if kk < 0 or kk >= L:
				continue
			var d: int = path[kk] - i
			m.road[i] |= 1 if d == 1 else (2 if d == -1 else (4 if d == N_ else 8))


static func _ore_field(m: GameMap, cx: float, cy: float, rad: float, r: Rng.Mulberry) -> void:
	var y := floori(cy - rad - 2)
	while y <= cy + rad + 2:
		var x := floori(cx - rad - 2)
		while x <= cx + rad + 2:
			if m.in_map(x, y):
				var d := Rng.hypot(x - cx, y - cy) + (Rng.fbm(x, y, 3, m.seed + 77, 2) - 0.5) * 2.2
				var i := m.idx(x, y)
				if d < rad and m.ter[i] != WATER and m.ter[i] != BRIDGE and m.ter[i] != ROAD:
					m.ter[i] = ORE
					var rv := r.next()
					m.ore[i] = int(Rng.js_round(ORE_PER_TILE * (0.55 + 0.45 * (1 - d / rad)) * (0.85 + rv * 0.3)))
					m.block[i] = 0
				elif d < rad + 1.6 and m.ter[i] == FOREST:
					m.ter[i] = GRASS
			x += 1
		y += 1


static func _paint_water(m: GameMap, cx: float, cy: float, rad: float) -> void:
	var y := floori(cy - rad - 1)
	while y <= cy + rad + 1:
		var x := floori(cx - rad - 1)
		while x <= cx + rad + 1:
			if m.in_map(x, y) and Rng.hypot(x + 0.5 - cx, y + 0.5 - cy) < rad:
				m.ter[m.idx(x, y)] = WATER
			x += 1
		y += 1


## a winding band of water between two points
static func _channel(m: GameMap, ax: float, ay: float, bx: float, by: float, w0: float, w1: float, seed_: int) -> void:
	var L := Rng.hypot(bx - ax, by - ay)
	var nx := -(by - ay) / L
	var ny := (bx - ax) / L
	var t := 0.0
	while t <= 1:
		var o := (Rng.fbm(t * L * 0.6, 3, 9, seed_, 2) - 0.5) * 7 * sin(t * PI)
		_paint_water(m, ax + (bx - ax) * t + nx * o, ay + (by - ay) * t + ny * o, w0 + (w1 - w0) * t)
		t += 0.5 / L


## a point of the river; as doubles, since Vector2 is single precision
static func _river_xy(t: float, N_: int, wob: float, seed_: int) -> PackedFloat64Array:
	var c := t * N_
	var o := (Rng.fbm(t * 60 + wob, 0, 12, seed_ + 9, 3) - 0.5) * N_ * 0.55
	return PackedFloat64Array([c + o * 0.7071, c - o * 0.7071])


static func _sea_line(d: float, N_: int, seed_: int) -> float:
	return N_ * 0.55 + (Rng.fbm(d + 200, 7, 14, seed_ + 13, 3) - 0.5) * 12


static func _near_start(m: GameMap, x: float, y: float, dist: float) -> bool:
	for s in m.starts:
		if Rng.hypot(s.x - x, s.y - y) < dist:
			return true
	return false


## ore: a place near (x, y) with dry land all round
static func _dry(m: GameMap, x: float, y: float) -> PackedFloat64Array:
	var N_ := m.N
	for r2 in 30:
		for k in 16:
			var a := (k / 16.0) * PI * 2
			var px := int(Rng.js_round(x + cos(a) * r2))
			var py := int(Rng.js_round(y + sin(a) * r2))
			if px < 4 or py < 4 or px > N_ - 5 or py > N_ - 5:
				continue
			var ok := true
			var dy := -3
			while dy <= 3 and ok:
				var dx := -3
				while dx <= 3 and ok:
					var t := m.ter[m.idx(px + dx, py + dy)]
					if t == WATER or t == BRIDGE:
						ok = false
					dx += 1
				dy += 1
			if ok:
				var every := true
				for s in m.starts:
					if not (Rng.hypot(s.x - px, s.y - py) > 6):
						every = false
						break
				if every:
					return PackedFloat64Array([px, py])
			if r2 == 0:
				break
	return PackedFloat64Array([x, y])


static func generate(seed_: int, type_: String = "land", N_: int = 96) -> GameMap:
	var m := GameMap.new(N_, seed_)
	m.type = type_
	var r := Rng.mulberry32(seed_)
	_split_parcels(m, r)

	# woods: noise on top of the forest parcels
	for y in N_:
		for x in N_:
			var i := m.idx(x, y)
			var f := Rng.fbm(x, y, 16, seed_ + 5, 3)
			if f > 0.64:
				m.ter[i] = FOREST
			elif m.ter[i] == FOREST and f < 0.38:
				m.ter[i] = GRASS

	# the river runs from the top corner to the bottom corner, between the two armies
	var wob := r.next() * 1000
	if type_ != "lakes":
		var wide := 0.7 if type_ == "coast" else 0.0
		var t := -0.02
		while t <= 1.02:
			var p := _river_xy(t, N_, wob, seed_)
			var w := 1.1 + wide + Rng.fbm(t * 40, 5, 8, seed_ + 11, 2) * 1.1
			_paint_water(m, p[0], p[1], w)
			t += 0.002
	if type_ == "land":
		# a pond or two
		for k in 2:
			if r.next() < 0.4:
				continue
			var side := 1 if k == 0 else -1
			var r1 := r.next()
			var r2 := r.next()
			var px := N_ * 0.5 + side * N_ * (0.12 + r1 * 0.1) + (r2 - 0.5) * N_ * 0.4
			var r3 := r.next()
			var r4 := r.next()
			var py := N_ * 0.5 - side * N_ * (0.12 + r3 * 0.1) + (r4 - 0.5) * N_ * 0.4
			var rad := 2 + r.next() * 2.5
			_blob(m, px, py, rad, seed_ + 3, 2.0)

	# where the bases are: the west (left) and the east (right) corner
	if type_ == "coast":
		m.starts = [Vector2i(12, 60), Vector2i(60, 12)]
	else:
		m.starts = [Vector2i(12, N_ - 13), Vector2i(N_ - 13, 12)]
	if type_ == "coast":
		# the sea along the north, with a sandy beach
		for y in N_:
			for x in N_:
				var d := x + y - _sea_line(x - y, N_, seed_)
				var i := m.idx(x, y)
				if d < 0:
					m.ter[i] = WATER
				elif d < 1.7 and m.ter[i] != WATER:
					m.ter[i] = SAND
	elif type_ == "lakes":
		# a big lake in the middle with an arm reaching towards each base
		var ra := r.next()
		var cx := N_ / 2.0 + (ra - 0.5) * 4
		var rb := r.next()
		var cy := N_ / 2.0 + (rb - 0.5) * 4
		var R := N_ * 0.13
		for y in N_:
			for x in N_:
				var a := atan2(y - cy, x - cx)
				var rr := R * (0.8 + Rng.fbm(cos(a) * 3 + 10, sin(a) * 3 + 10, 2, seed_ + 17, 2) * 0.5)
				if Rng.hypot(x + 0.5 - cx, y + 0.5 - cy) < rr:
					m.ter[m.idx(x, y)] = WATER
		for s in m.starts:
			var dx := cx - s.x
			var dy := cy - s.y
			var d := Rng.hypot(dx, dy)
			_channel(m, s.x + (dx / d) * 9, s.y + (dy / d) * 9, cx, cy, 2.2, 2.6, seed_ + s.x)
			_paint_water(m, s.x + (dx / d) * 9.5, s.y + (dy / d) * 9.5, 2.8)
		# two small lakes towards the other corners
		for pp in [[N_ * 0.2, N_ * 0.2], [N_ * 0.8, N_ * 0.8]]:
			var rad := 3 + r.next() * 2.5
			_blob(m, pp[0], pp[1], rad, seed_ + 3, 2.5)
	for s in m.starts:
		for y in range(s.y - 11, s.y + 12):
			for x in range(s.x - 11, s.x + 12):
				if not m.in_map(x, y):
					continue
				var d := Rng.hypot(x - s.x, y - s.y)
				var i := m.idx(x, y)
				if d < 7.5 and (m.ter[i] == FOREST or m.ter[i] == WATER):
					m.ter[i] = GRASS
					m.variant[i] = 0
				elif d < 10 and m.ter[i] == FOREST:
					m.ter[i] = GRASS

	for i in N_ * N_:
		m.block[i] = 1 if m.ter[i] == WATER or m.ter[i] == FOREST else 0

	# roads: two routes between the bases over different bridges
	var A: Vector2i = m.starts[0]
	var B: Vector2i = m.starts[1]
	var ways: Array[PackedFloat64Array] = []
	if type_ == "coast":
		var w1 := _river_xy(0.47 + r.next() * 0.06, N_, wob, seed_)
		var w2 := _river_xy(0.74 + r.next() * 0.08, N_, wob, seed_)
		ways = [w1, w2]
	elif type_ == "lakes":
		ways = [PackedFloat64Array([N_ * 0.24, N_ * 0.24]), PackedFloat64Array([N_ * 0.76, N_ * 0.76])]
	else:
		var w1 := _river_xy(0.3 + r.next() * 0.08, N_, wob, seed_)
		var w2 := _river_xy(0.62 + r.next() * 0.08, N_, wob, seed_)
		ways = [w1, w2]
	for c in ways:
		var cx := maxi(2, mini(N_ - 3, int(Rng.js_round(c[0]))))
		var cy := maxi(2, mini(N_ - 3, int(Rng.js_round(c[1]))))
		_lay_road(m, _road_path(m, A.x + 2, A.y - 2, cx, cy))
		_lay_road(m, _road_path(m, cx, cy, B.x - 2, B.y + 2))

	# villages along the roads, away from the bases
	var road_tiles := PackedInt32Array()
	for i in N_ * N_:
		if m.ter[i] == ROAD:
			road_tiles.push_back(i)
	var villages: Array[Vector2i] = []
	var tries := 0
	while tries < 400 and villages.size() < 4:
		var rv := r.next()
		if road_tiles.is_empty():
			break
		var i := road_tiles[floori(rv * road_tiles.size())]
		tries += 1
		var x := i % N_
		@warning_ignore("integer_division")
		var y := i / N_
		if _near_start(m, x, y, 20):
			continue
		var close := false
		for v in villages:
			if Rng.hypot(v.x - x, v.y - y) < 22:
				close = true
				break
		if close:
			continue
		villages.append(Vector2i(x, y))
	var church := false
	for v in villages:
		var houses := 0
		var want := 5 + floori(r.next() * 5)
		var ht := 0
		while ht < 80 and houses < want:
			ht += 1
			var x := v.x + int(Rng.js_round((r.next() - 0.5) * 8))
			var y := v.y + int(Rng.js_round((r.next() - 0.5) * 8))
			if not m.in_map(x, y) or x < 1 or y < 1 or x > N_ - 2 or y > N_ - 2:
				continue
			var i := m.idx(x, y)
			if m.ter[i] == ROAD or m.ter[i] == BRIDGE or m.ter[i] == WATER or m.ter[i] == ORE:
				continue
			if m.tile_statics[i] != null:
				continue
			# next to a road or another house
			var near := false
			for dy in range(-1, 2):
				for dx in range(-1, 2):
					var j := m.idx(x + dx, y + dy)
					if m.ter[j] == ROAD:
						near = true
					elif m.tile_statics[j] != null:
						for s in m.tile_statics[j]:
							if s.kind != "oak" and s.kind != "pine" and s.kind != "birch":
								near = true
								break
			if not near:
				continue
			var kind := ""
			if not church:
				kind = "church"
			elif r.next() < 0.15:
				kind = "barn"
			elif r.next() < 0.4:
				kind = "timber"
			else:
				kind = "house"
			church = true
			m.ter[i] = GRASS
			m.variant[i] = 2
			m.block[i] = 1
			m.add_static({"kind": kind, "v": floori(r.next() * 4), "x": x + 0.5, "y": y + 0.5})
			houses += 1
		# the village clears the wood round it
		for y in range(v.y - 6, v.y + 7):
			for x in range(v.x - 6, v.x + 7):
				if not m.in_map(x, y):
					continue
				var i := m.idx(x, y)
				if m.ter[i] == FOREST and Rng.hypot(x - v.x, y - v.y) < 5:
					m.ter[i] = GRASS
					m.block[i] = 0

	# ore: two fields by each base and three to fight over, always on dry land
	for k in 2:
		var s: Vector2i = m.starts[k]
		var sgn := 1 if k == 0 else -1
		var a1 := r.next()
		var a2 := r.next()
		var f1 := _dry(m, s.x + sgn * 8 + (a1 - 0.5) * 2, s.y + sgn * 1 + (a2 - 0.5) * 2)
		var b1 := r.next()
		var b2 := r.next()
		var f2 := _dry(m, s.x + sgn * -1 + (b1 - 0.5) * 2, s.y - sgn * 8 + (b2 - 0.5) * 2)
		_ore_field(m, f1[0], f1[1], 2.6, r)
		_ore_field(m, f2[0], f2[1], 2.6, r)
	var mids: Array
	if type_ == "coast":
		mids = [[N_ * 0.62, N_ * 0.62], [N_ * 0.4, N_ * 0.75], [N_ * 0.75, N_ * 0.4]]
	else:
		mids = [[N_ * 0.5, N_ * 0.5], [N_ * 0.2, N_ * 0.2], [N_ * 0.8, N_ * 0.8]]
	for mp in mids:
		var c1 := r.next()
		var c2 := r.next()
		var p := _dry(m, mp[0] + (c1 - 0.5) * 6, mp[1] + (c2 - 0.5) * 6)
		_ore_field(m, p[0], p[1], 3.2, r)
	for i in N_ * N_:
		if m.ter[i] == ORE:
			m.block[i] = 0

	# trees in the woods, and a few on their own in the fields
	for y in N_:
		for x in N_:
			var i := m.idx(x, y)
			if m.ter[i] == FOREST:
				var pines := Rng.fbm(x, y, 20, seed_ + 21, 2) > 0.5
				var n := 1 + (1 if r.next() < 0.55 else 0)
				for k in n:
					var kind := ""
					if pines:
						kind = "pine" if r.next() < 0.85 else "oak"
					elif r.next() < 0.12:
						kind = "birch"
					elif r.next() < 0.2:
						kind = "pine"
					else:
						kind = "oak"
					var vv := floori(r.next() * 4)
					var sx := x + 0.2 + r.next() * 0.6
					var sy := y + 0.2 + r.next() * 0.6
					m.add_static({"kind": kind, "v": vv, "x": sx, "y": sy})
			elif (m.ter[i] == GRASS or m.ter[i] == FIELD) and m.block[i] == 0 and m.tile_statics[i] == null:
				# lone trees along the edges of fields
				var edge := x > 0 and y > 0 and (m.parcel[i] != m.parcel[i - 1] or m.parcel[i] != m.parcel[i - N_])
				if r.next() < (0.06 if edge else 0.008) and not _near_start(m, x, y, 11):
					var kind := "birch" if r.next() < 0.3 else "oak"
					var vv := floori(r.next() * 4)
					m.add_static({"kind": kind, "v": vv, "x": x + 0.5, "y": y + 0.5})
					m.block[i] = 1
	m.measure_depth()
	return m


## a pond: a noisy disc of water
static func _blob(m: GameMap, px: float, py: float, rad: float, seed_: int, rough: float) -> void:
	var y := floori(py - rad - 2)
	while y <= py + rad + 2:
		var x := floori(px - rad - 2)
		while x <= px + rad + 2:
			if m.in_map(x, y) and Rng.hypot(x - px, y - py) + (Rng.fbm(x, y, 3, seed_, 2) - 0.5) * rough < rad:
				m.ter[m.idx(x, y)] = WATER
			x += 1
		y += 1
