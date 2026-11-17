class_name PathFinder
extends RefCounted
## Path finding on the tile grid: A* over eight directions without cutting corners, then the
## path is pulled tight so units drive in straight lines wherever the ground allows.
##
## Port of src/game/path.ts (same heuristic, step costs, heap order and smoothing, so paths are
## identical). Passing the map's own `walk_i` / `nav_i` (or nothing) uses fast inlined checks.

const _MODE_WALK := 0
const _MODE_NAV := 1
const _MODE_CALL := 2

## 1.4142 - 2 of the heuristic, worked out in doubles as in JS
const _HK := 1.4142 - 2.0

## the eight neighbours in the prototype's order (dy outer, dx inner)
const _DX: Array[int] = [-1, 0, 1, -1, 1, -1, 0, 1]
const _DY: Array[int] = [-1, -1, -1, 0, 0, 1, 1, 1]

var map: GameMap
## which tiles this finder may use (`pass` in the prototype, a keyword here): ground units by
## default, boats with `map.nav_i`
var pass_fn: Callable
var g: PackedFloat32Array
var came: PackedInt32Array
var stamp: PackedInt32Array
var closed: PackedInt32Array
var run := 1
var _mode := _MODE_WALK
# binary heap of tile indices keyed by f (keys are doubles, as JS numbers), reused between calls
var _hi := PackedInt32Array()
var _hk := PackedFloat64Array()
# the eight neighbours as steps and as index offsets
var _dxs := PackedInt32Array(_DX)
var _dys := PackedInt32Array(_DY)
var _off := PackedInt32Array()


func _init(map_: GameMap, pass_: Callable = Callable()) -> void:
	map = map_
	if not pass_.is_valid() or pass_ == Callable(map_, &"walk_i"):
		pass_fn = Callable(map_, &"walk_i")
		_mode = _MODE_WALK
	elif pass_ == Callable(map_, &"nav_i"):
		pass_fn = pass_
		_mode = _MODE_NAV
	else:
		pass_fn = pass_
		_mode = _MODE_CALL
	var n := map.N * map.N
	g = PackedFloat32Array()
	g.resize(n)
	came = PackedInt32Array()
	came.resize(n)
	stamp = PackedInt32Array()
	stamp.resize(n)
	closed = PackedInt32Array()
	closed.resize(n)
	_hi.resize(256)
	_hk.resize(256)
	for k in 8:
		_off.push_back(_DY[k] * map.N + _DX[k])


func _pass(i: int) -> bool:
	if _mode == _MODE_WALK:
		return map.block[i] == 0 and map.bld[i] == 0
	if _mode == _MODE_NAV:
		var t := map.ter[i]
		return t == GameMap.WATER or t == GameMap.BRIDGE
	return pass_fn.call(i)


func ok(x: int, y: int) -> bool:
	var N := map.N
	return x >= 0 and y >= 0 and x < N and y < N and _pass(y * N + x)


## the nearest tile a unit of this kind can stand on; Vector2i(-1, -1) if there is none
func nearest_walkable(x: float, y: float, max_r: int = 12) -> Vector2i:
	var tx := floori(x)
	var ty := floori(y)
	if ok(tx, ty):
		return Vector2i(tx, ty)
	for r in range(1, max_r + 1):
		var best := Vector2i(-1, -1)
		var found := false
		var bd := 1e9
		for dy in range(-r, r + 1):
			for dx in range(-r, r + 1):
				if maxi(absi(dx), absi(dy)) != r:
					continue
				if not ok(tx + dx, ty + dy):
					continue
				var d := Rng.hypot(tx + dx + 0.5 - x, ty + dy + 0.5 - y)
				if d < bd:
					bd = d
					best = Vector2i(tx + dx, ty + dy)
					found = true
		if found:
			return best
	return Vector2i(-1, -1)


static func _h(x: int, y: int, gx: int, gy: int) -> float:
	var dx := absi(x - gx)
	var dy := absi(y - gy)
	return (dx + dy + _HK * mini(dx, dy)) * 1.05


## A path of tile indices from (sx,sy) to (gx,gy). If the goal cannot be reached, the path leads
## to the closest place that can.
func find(sx: int, sy: int, gx: int, gy: int, max_nodes: int = 6000) -> PackedInt32Array:
	var m := map
	var N := m.N
	var start := m.idx(sx, sy)
	var goal := m.idx(gx, gy)
	if not _pass(goal):
		var w := nearest_walkable(gx + 0.5, gy + 0.5)
		if w.x < 0:
			return PackedInt32Array()
		gx = w.x
		gy = w.y
		goal = m.idx(gx, gy)
	if start == goal:
		return PackedInt32Array([goal])
	run += 1
	var rn := run
	var g_ := g
	var came_ := came
	var stamp_ := stamp
	var closed_ := closed
	var ter := m.ter
	var block := m.block
	var bld := m.bld
	var mode := _mode
	var dxs := _dxs
	var dys := _dys
	var off := _off
	# the heap can never hold more than eight entries per expanded tile, so it is sized once and
	# push/pop below are the prototype's Heap inlined
	var cap := 8 * mini(max_nodes, N * N) + 16
	if _hi.size() < cap:
		_hi.resize(cap)
		_hk.resize(cap)
	var hi := _hi
	var hk := _hk
	stamp_[start] = rn
	g_[start] = 0.0
	came_[start] = -1
	var h0 := _h(sx, sy, gx, gy)
	hi[0] = start
	hk[0] = h0
	var hn := 1
	var best := start
	var best_h := h0
	var nodes := 0
	while hn > 0:
		# pop
		var cur := hi[0]
		hn -= 1
		if hn > 0:
			var li := hi[hn]
			var lk := hk[hn]
			var q := 0
			while true:
				var ch := 2 * q + 1
				if ch >= hn:
					break
				if ch + 1 < hn and hk[ch + 1] < hk[ch]:
					ch += 1
				if hk[ch] >= lk:
					break
				hi[q] = hi[ch]
				hk[q] = hk[ch]
				q = ch
			hi[q] = li
			hk[q] = lk
		if closed_[cur] == rn:
			continue
		closed_[cur] = rn
		if cur == goal:
			best = cur
			break
		nodes += 1
		if nodes > max_nodes:
			break
		var cx := cur % N
		@warning_ignore("integer_division")
		var cy := cur / N
		var hdx := absi(cx - gx)
		var hdy := absi(cy - gy)
		var hc := (hdx + hdy + _HK * mini(hdx, hdy)) * 1.05
		if hc < best_h:
			best_h = hc
			best = cur
		var gc: float = g_[cur]
		var interior := cx > 0 and cy > 0 and cx < N - 1 and cy < N - 1
		for k in 8:
			var dx := dxs[k]
			var dy := dys[k]
			var nx := cx + dx
			var ny := cy + dy
			if not interior and (nx < 0 or ny < 0 or nx >= N or ny >= N):
				continue
			var ni := cur + off[k]
			var diag := k != 1 and k != 3 and k != 4 and k != 6
			if mode == _MODE_WALK:
				if block[ni] != 0 or bld[ni] != 0:
					continue
				if diag:
					var a := cur + dx
					var b := cur + dy * N
					if block[a] != 0 or bld[a] != 0 or block[b] != 0 or bld[b] != 0:
						continue
			elif mode == _MODE_NAV:
				var tn := ter[ni]
				if tn != GameMap.WATER and tn != GameMap.BRIDGE:
					continue
				if diag:
					var ta := ter[cur + dx]
					var tb := ter[cur + dy * N]
					if (ta != GameMap.WATER and ta != GameMap.BRIDGE) or (tb != GameMap.WATER and tb != GameMap.BRIDGE):
						continue
			else:
				if not pass_fn.call(ni):
					continue
				if diag and (not pass_fn.call(cur + dx) or not pass_fn.call(cur + dy * N)):
					continue
			var t := ter[ni]
			var step := (1.4142 if diag else 1.0) * (0.75 if t == GameMap.ROAD or t == GameMap.BRIDGE else 1.0)
			var ng := gc + step
			if stamp_[ni] == rn and ng >= g_[ni]:
				continue
			stamp_[ni] = rn
			g_[ni] = ng
			came_[ni] = cur
			# push
			var ndx := absi(nx - gx)
			var ndy := absi(ny - gy)
			var key := ng + (ndx + ndy + _HK * mini(ndx, ndy)) * 1.05
			var n := hn
			hn += 1
			while n > 0:
				var pp := (n - 1) >> 1
				if hk[pp] <= key:
					break
				hi[n] = hi[pp]
				hk[n] = hk[pp]
				n = pp
			hi[n] = ni
			hk[n] = key
	var path := PackedInt32Array()
	var c := best
	while c != -1 and c != start:
		path.push_back(c)
		c = came_[c]
	path.reverse()
	return smooth(sx + 0.5, sy + 0.5, path)


## is the straight line between two points clear of obstacles (with a little width)
func clear(ax: float, ay: float, bx: float, by: float, half: float = 0.3) -> bool:
	var d := Rng.hypot(bx - ax, by - ay)
	var n := ceili(d / 0.25)
	var dd := d if d != 0.0 else 1.0
	var px := -(by - ay) / dd
	var py := (bx - ax) / dd
	var N := map.N
	var walk := _mode == _MODE_WALK
	var block := map.block
	var bld := map.bld
	for k in range(1, n + 1):
		var t := float(k) / n
		var x := ax + (bx - ax) * t
		var y := ay + (by - ay) * t
		var x1 := floori(x + px * half)
		var y1 := floori(y + py * half)
		var x2 := floori(x - px * half)
		var y2 := floori(y - py * half)
		if walk:
			# ok() inlined for ground units
			if x1 < 0 or y1 < 0 or x1 >= N or y1 >= N:
				return false
			var i1 := y1 * N + x1
			if block[i1] != 0 or bld[i1] != 0:
				return false
			if x2 < 0 or y2 < 0 or x2 >= N or y2 >= N:
				return false
			var i2 := y2 * N + x2
			if block[i2] != 0 or bld[i2] != 0:
				return false
		else:
			if not ok(x1, y1):
				return false
			if not ok(x2, y2):
				return false
	return true


func smooth(sx: float, sy: float, path: PackedInt32Array) -> PackedInt32Array:
	if path.size() < 3:
		return path
	var N := map.N
	var out := PackedInt32Array()
	var ax := sx
	var ay := sy
	var k := 0
	var L := path.size()
	while k < L:
		var far := k
		var j := mini(L - 1, k + 12)
		while j > k:
			var bx := (path[j] % N) + 0.5
			@warning_ignore("integer_division")
			var by := (path[j] / N) + 0.5
			if clear(ax, ay, bx, by):
				far = j
				break
			j -= 1
		out.push_back(path[far])
		ax = (path[far] % N) + 0.5
		@warning_ignore("integer_division")
		ay = (path[far] / N) + 0.5
		k = far + 1
	return out
