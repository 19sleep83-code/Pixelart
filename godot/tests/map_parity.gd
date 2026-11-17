extends SceneTree
## godot --headless --path godot -s tests/map_parity.gd
## Prints the same checksums as the TypeScript harness (rng, generated maps, paths), so the two
## outputs can be compared line by line. Timings go to the end, after a "---" line.

var _done := false
var _h := 2166136261
var _out: Array[String] = []


func _reset() -> void:
	_h = 2166136261


func _add(v: int) -> void:
	_h = Rng.imul_u((_h ^ (v & 0xFFFFFFFF)) & 0xFFFFFFFF, 16777619)


func _add_f(v: float) -> void:
	var b := PackedFloat64Array([v]).to_byte_array()
	_add(b.decode_u32(0))
	_add(b.decode_u32(4))


func _hex() -> String:
	return "%08x" % _h


func _arr_hash(a: Variant) -> String:
	_reset()
	for v in a:
		_add(v)
	return _hex()


func _p(s: String) -> void:
	_out.append(s)


func _u(v: float) -> String:
	return str(int(v * 4294967296.0))


func _process(_delta: float) -> bool:
	if _done:
		return true
	_done = true
	_run()
	return true


func _run() -> void:
	for s in [0, 1, 42, 123456789, -5, 4294967295, 2147483648]:
		var r := Rng.mulberry32(s)
		var vs: PackedStringArray = []
		for k in 20:
			vs.append(_u(r.next()))
		_p("mulberry %d: %s" % [s, " ".join(vs)])
	var vs2: PackedStringArray = []
	for c in [[0, 0, 0], [1, 2, 3], [-1, -7, 5], [95, 95, 777], [123456, -98765, 4242], [2147483647, -2147483648, 11], [9215, 3, 1]]:
		vs2.append(_u(Rng.hash2(c[0], c[1], c[2])))
	_p("hash2: " + " ".join(vs2))
	var ws: PackedStringArray = []
	for c in [[0, 0, 0], [3, 4, 9], [-2, 5, 77], [31, 17, 100003]]:
		ws.append(_u(Rng.hash3(c[0], c[1], c[2])))
	_p("hash3: " + " ".join(ws))

	var r99 := Rng.mulberry32(99)
	var hv := 2166136261
	var hf := 2166136261
	for k in 2000:
		var x := (r99.next() - 0.3) * 300
		var y := (r99.next() - 0.3) * 300
		var c := 1 + r99.next() * 20
		var s := floori(r99.next() * 1000)
		_h = hv
		_add_f(Rng.value_noise(x, y, c, s))
		hv = _h
		_h = hf
		_add_f(Rng.fbm(x, y, c, s, 1 + (k % 4)))
		hf = _h
	_h = hv
	_p("valueNoise: " + _hex())
	_h = hf
	_p("fbm: " + _hex())
	var r7 := Rng.mulberry32(7)
	var hs: Array[int] = [2166136261, 2166136261, 2166136261, 2166136261]
	for k in 20000:
		var a := (r7.next() - 0.5) * 200
		var b := (r7.next() - 0.5) * 200
		var vals := [Rng.hypot(a, b), sin(a), cos(a), atan2(a, b)]
		for j in 4:
			_h = hs[j]
			_add_f(vals[j])
			hs[j] = _h
	_h = hs[0]
	_p("hypot: " + _hex())
	var info: PackedStringArray = []
	for j in range(1, 4):
		_h = hs[j]
		info.append(_hex())
	_p("sin(info): %s  cos(info): %s  atan2(info): %s" % [info[0], info[1], info[2]])

	var kinds := ["oak", "pine", "birch", "house", "timber", "church", "barn"]
	var types := ["land", "coast", "lakes"]
	var gen_us := 0
	var gen_n := 0
	var find_us := 0
	var find_n := 0
	for seed_ in [1, 11, 777, 4242]:
		for ti in 3:
			var type_: String = types[ti]
			var t0 := Time.get_ticks_usec()
			var m := GameMap.generate(seed_, type_)
			gen_us += Time.get_ticks_usec() - t0
			gen_n += 1
			_reset()
			for s in m.statics:
				_add(kinds.find(s.kind))
				_add(s.v)
				_add_f(s.x)
				_add_f(s.y)
			var sh := _hex()
			_reset()
			for i in m.N * m.N:
				_add(0 if m.tile_statics[i] == null else m.tile_statics[i].size())
			var tsh := _hex()
			_p("map %d %s: ter=%s variant=%s road=%s ore=%s parcel=%s block=%s depth=%s" % [seed_, type_,
				_arr_hash(m.ter), _arr_hash(m.variant), _arr_hash(m.road), _arr_hash(m.ore),
				_arr_hash(m.parcel), _arr_hash(m.block), _arr_hash(m.depth)])
			var st: PackedStringArray = []
			for s in m.starts:
				st.append("%d,%d" % [s.x, s.y])
			_p("  statics %d %s: n=%d h=%s tile=%s starts=%s" % [seed_, type_, m.statics.size(), sh, tsh, ";".join(st)])

			var pf := PathFinder.new(m)
			var r := Rng.mulberry32(seed_ * 7 + ti)
			var N := m.N
			var lens: PackedStringArray = []
			_reset()
			for k in 12:
				var sx := floori(r.next() * N)
				var sy := floori(r.next() * N)
				var gx := floori(r.next() * N)
				var gy := floori(r.next() * N)
				var s := pf.nearest_walkable(sx + 0.5, sy + 0.5)
				if s.x < 0:
					lens.append("-")
					continue
				var p := pf.find(s.x, s.y, gx, gy, 300 if k >= 10 else 6000)
				lens.append(str(p.size()))
				for i in p:
					_add(i)
				_add(0xffffffff)
			_p("  path %d %s: %s h=%s" % [seed_, type_, " ".join(lens), _hex()])
			var nw: PackedStringArray = []
			for k in 10:
				var x := r.next() * N
				var y := r.next() * N
				var w := pf.nearest_walkable(x, y, 1 + (k % 5) * 3)
				nw.append("%d,%d" % [w.x, w.y] if w.x >= 0 else "null")
			_p("  nearest %d %s: %s" % [seed_, type_, " ".join(nw)])
			var bf := PathFinder.new(m, m.nav_i)
			var bl: PackedStringArray = []
			_reset()
			for k in 6:
				var bx := r.next() * N
				var by := r.next() * N
				var s := bf.nearest_walkable(bx, by, 30)
				var gx := floori(r.next() * N)
				var gy := floori(r.next() * N)
				if s.x < 0:
					bl.append("-")
					continue
				var p := bf.find(s.x, s.y, gx, gy)
				bl.append(str(p.size()))
				for i in p:
					_add(i)
				_add(0xffffffff)
			_p("  boat %d %s: %s h=%s" % [seed_, type_, " ".join(bl), _hex()])

			# a pass of its own: ground units that keep off roads
			var cf := PathFinder.new(m, func(i: int) -> bool: return m.walk_i(i) and m.ter[i] != GameMap.ROAD)
			var cl: PackedStringArray = []
			_reset()
			for k in 4:
				var cx := r.next() * N
				var cy := r.next() * N
				var s := cf.nearest_walkable(cx, cy)
				var gx := floori(r.next() * N)
				var gy := floori(r.next() * N)
				if s.x < 0:
					cl.append("-")
					continue
				var p := cf.find(s.x, s.y, gx, gy, 2000)
				cl.append(str(p.size()))
				for i in p:
					_add(i)
				_add(0xffffffff)
			_p("  noroad %d %s: %s h=%s" % [seed_, type_, " ".join(cl), _hex()])

			# 100 finds between random walkable tiles: timed, and checked as well
			var rt := Rng.mulberry32(seed_ + 1000 * ti)
			var paths: Array[PackedInt32Array] = []
			var t1 := Time.get_ticks_usec()
			for k in 100:
				var a := pf.nearest_walkable(rt.next() * N, rt.next() * N, 40)
				var gx2 := floori(rt.next() * N)
				var gy2 := floori(rt.next() * N)
				if a.x >= 0:
					paths.append(pf.find(a.x, a.y, gx2, gy2))
			find_us += Time.get_ticks_usec() - t1
			find_n += 100
			_reset()
			var bs := 0
			for p in paths:
				bs += p.size()
				for i in p:
					_add(i)
				_add(0xffffffff)
			_p("  bulk %d %s: finds=%d waypoints=%d h=%s" % [seed_, type_, paths.size(), bs, _hex()])
	for line in _out:
		print(line)
	print("---")
	print("generate(): %.1f ms average over %d maps" % [gen_us / 1000.0 / gen_n, gen_n])
	print("find(): %.1f ms per 100 calls (average over %d calls)" % [find_us / 1000.0 / find_n * 100, find_n])
