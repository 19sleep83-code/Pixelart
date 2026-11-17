extends Node
## AI against AI (player 0 is a computer too), as the prototype's balance harness:
##   godot --headless --path godot res://tests/runner.tscn -- sim_aivai [minutes] [seed:map …]
## Prints the winner, the time, losses and kills, the units built per type and the time per tick.

const RUNS := [[11, "land"], [23, "coast"], [37, "lakes"], [51, "land"], [4242, "coast"], [77, "lakes"]]


func run(args: PackedStringArray) -> void:
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
		while t < minutes * 60 and g.over == 0:
			var c0 := Time.get_ticks_usec()
			g.update(dt)
			a0.update(dt)
			a1.update(dt)
			var el := (Time.get_ticks_usec() - c0) / 1000.0
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
		print("   ms/tick avg %.3f worst %.2f (at %.0f s), ticks > 10 ms: %d of %d, most units %d, init %.0f ms" % [tot / n, worst, worst_at, slow, n, max_units, t_init])
		var parts: Array[String] = []
		for k: String in built:
			parts.append("%s:%d" % [k, built[k]])
		print("   gebaut: ", " ".join(parts))
		if n == 0:
			all_ok = false
	print("DONE" if all_ok else "FAILED")
