extends Node
## AI against AI (player 0 is a computer too), as the prototype's balance harness:
##   godot --headless --path godot res://tests/runner.tscn -- sim_aivai [minutes] [seed:map …]
## Prints the winner, the time, losses and kills, the units built per type and the time per tick.
##   … -- sim_aivai stress [units per side] [seed:map]
## puts that many units per side (default 75) on the map, sends them at each other and times the ticks.

const RUNS := [[11, "land"], [23, "coast"], [37, "lakes"], [51, "land"], [4242, "coast"], [77, "lakes"]]


func run(args: PackedStringArray) -> void:
	if args.size() > 0 and args[0] == "stress":
		_stress(args.slice(1))
		return
	var minutes := 40.0
	var runs: Array = RUNS
	if args.size() > 0:
		minutes = float(args[0])
	if args.size() > 1:
		runs = []
		for a in args.slice(1):
			var parts := a.split(":")
			runs.append([int(parts[0]), parts[1]])
	var all_ok := true
	for r: Array in runs:
		var seed_: int = r[0]
		var map_type: String = r[1]
		var t0 := Time.get_ticks_usec()
		var g := Game.new({"seed": seed_, "faction": "nato", "difficulty": 2, "mapType": map_type, "tod": "day", "weather": "clear"})
		var t_init := (Time.get_ticks_usec() - t0) / 1000.0
		g.players[0].ai = true
		var a0 := AI.new(g)
		a0.p = 0
		var a1 := AI.new(g)
		var dt := 1.0 / 15.0
		var built := {}
		var seen := {}
		var t := 0.0
		var tot := 0.0
		var worst := 0.0
		var worst_at := 0.0
		var n := 0
		var max_units := 0
		var slow := 0
		var worst_g := 0.0
		var worst_ai := 0.0
		var tot_g := 0.0
		while t < minutes * 60 and g.over == 0:
			var c0 := Time.get_ticks_usec()
			g.update(dt)
			var c1 := Time.get_ticks_usec()
			a0.update(dt)
			a1.update(dt)
			var el := (Time.get_ticks_usec() - c0) / 1000.0
			var el_g := (c1 - c0) / 1000.0
			worst_g = maxf(worst_g, el_g)
			worst_ai = maxf(worst_ai, el - el_g)
			tot_g += el_g
			tot += el
			n += 1
			if el > worst:
				worst = el
				worst_at = t
			if el > 10:
				slow += 1
			if floori(t) % 5 == 0:
				var units := 0
				for e in g.ents:
					if not e.is_b:
						units += 1
						if not seen.has(e.id):
							seen[e.id] = true
							built[e.key] = built.get(e.key, 0) + 1
				max_units = maxi(max_units, units)
			t += dt
		var res := "NATO (Spieler 0) gewinnt" if g.over == 1 else ("Russland (Spieler 1) gewinnt" if g.over == -1 else "offen")
		var st: Array[String] = []
		for p in g.players:
			st.append("%s: verloren %d, zerstört %d" % [p.faction, p.stats.lost, p.stats.killed])
		print("%s #%d: %s nach %.1f min | %s" % [map_type, seed_, res, t / 60.0, " | ".join(st)])
		print("   ms/tick avg %.3f (game %.3f) worst %.2f at %.0f s (game alone %.2f, AI alone %.2f), ticks > 10 ms: %d of %d, most units %d, init %.0f ms" % [tot / n, tot_g / n, worst, worst_at, worst_g, worst_ai, slow, n, max_units, t_init])
		var parts: Array[String] = []
		for k: String in built:
			parts.append("%s:%d" % [k, built[k]])
		print("   gebaut: ", " ".join(parts))
		if n == 0:
			all_ok = false
		g.dispose()
	print("DONE" if all_ok else "FAILED")


const MIX := {"rifle": 25, "at": 15, "sniper": 3, "engineer": 1, "ifv": 8, "mbt": 10, "aa": 4, "art": 4, "mlrs": 2, "heli": 3}


func _stress(args: PackedStringArray) -> void:
	var per_side := int(args[0]) if args.size() > 0 else 75
	var spec := (args[1] if args.size() > 1 else "11:land").split(":")
	var g := Game.new({"seed": int(spec[0]), "faction": "nato", "difficulty": 2, "mapType": spec[1]})
	g.players[0].ai = true
	var a0 := AI.new(g)
	a0.p = 0
	var a1 := AI.new(g)
	var hqs: Array[Ent] = [null, null]
	for e in g.ents:
		if e.key == "hq":
			hqs[e.owner] = e
	var total := 0
	for k: String in MIX:
		total += MIX[k]
	for p in 2:
		var hq := hqs[p]
		var foe := hqs[1 - p]
		var army: Array[Ent] = []
		var n := 0
		for k: String in MIX:
			var count := roundi(float(MIX[k]) * per_side / total)
			for i in count:
				var f := 0.25 + 0.1 * (n % 5)
				var w := g.pf.nearest_walkable(hq.x + (foe.x - hq.x) * f + (n % 7) - 3, hq.y + (foe.y - hq.y) * f + (floori(n / 7.0) % 7) - 3, 20)
				army.append(g.add_unit(p, k, w.x + 0.5, w.y + 0.5))
				n += 1
		g.command_move(army, foe.x, foe.y, true)
	var dt := 1.0 / 30.0
	var t := 0.0
	var tot := 0.0
	var worst := 0.0
	var n_ticks := 0
	var slow := 0
	var most := 0
	var hist := PackedInt32Array([0, 0, 0, 0, 0])
	while t < 180 and g.over == 0:
		var c0 := Time.get_ticks_usec()
		g.update(dt)
		a0.update(dt)
		a1.update(dt)
		var el := (Time.get_ticks_usec() - c0) / 1000.0
		tot += el
		n_ticks += 1
		worst = maxf(worst, el)
		hist[mini(4, floori(el / 2.5))] += 1
		if el > 10:
			slow += 1
		var units := 0
		for e in g.ents:
			if not e.is_b:
				units += 1
		most = maxi(most, units)
		t += dt
		if n_ticks % 900 == 0:
			print("  %3.0f s: %d units, %d shots, %d fx, avg so far %.2f ms" % [t, units, g.shots.size(), g.fx.size(), tot / n_ticks])
	print("stress %d per side on %s #%s at 30 Hz: avg %.2f ms/tick, worst %.2f, ticks > 10 ms: %d of %d, most units %d" % [per_side, spec[1], spec[0], tot / n_ticks, worst, slow, n_ticks, most])
	print("   ticks <2.5 ms %d, <5 %d, <7.5 %d, <10 %d, >=10 %d" % [hist[0], hist[1], hist[2], hist[3], hist[4]])
	print("   losses: %d / %d" % [g.players[0].stats.lost, g.players[1].stats.lost])
	g.dispose()
