extends Node
## A timeline of an AI-against-AI game every 30 s (credits, buildings, units, losses, waves), to
## compare with the prototype's run of the same seed:
##   godot --headless --path godot res://tests/runner.tscn -- sim_timeline [seed] [map] [minutes]


func run(args: PackedStringArray) -> void:
	var seed_ := int(args[0]) if args.size() > 0 else 11
	var map_type := args[1] if args.size() > 1 else "land"
	var mins := float(args[2]) if args.size() > 2 else 10.0
	var g := Game.new({"seed": seed_, "faction": "nato", "difficulty": 2, "mapType": map_type})
	g.players[0].ai = true
	var a0 := AI.new(g)
	a0.p = 0
	var a1 := AI.new(g)
	var dt := 1.0 / 15.0
	var t := 0.0
	var nxt := 0.0
	while t < mins * 60 and g.over == 0:
		g.update(dt)
		a0.update(dt)
		a1.update(dt)
		if t >= nxt:
			nxt += 30
			var s: Array[String] = []
			for p in g.players:
				var nb := 0
				var nu := 0
				var cnt := {}
				for e in g.ents:
					if e.owner != p.id:
						continue
					if e.is_b:
						nb += 1
					else:
						nu += 1
						cnt[e.key] = cnt.get(e.key, 0) + 1
				var ai: AI = a0 if p.id == 0 else a1
				var parts: Array[String] = []
				for k: String in cnt:
					parts.append("%s%d" % [k, cnt[k]])
				s.append("P%d cr %d b%d u%d L%d K%d att%d w%d%s [%s]" % [p.id, roundi(p.credits), nb, nu, p.stats.lost, p.stats.killed, ai._attackers.size(), ai._waves, ai._wave.phase if ai._wave != null else "-", " ".join(parts)])
			print("%ds %s" % [roundi(t), " || ".join(s)])
		t += dt
	print("over ", g.over, " ", "%.1f" % (t / 60.0))
