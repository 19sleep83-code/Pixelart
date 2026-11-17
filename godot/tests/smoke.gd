extends SceneTree
## godot --headless --path godot -s tests/smoke.gd

var _done := false


func _process(_delta: float) -> bool:
	if _done:
		return true
	_done = true
	var data = root.get_node("Data")
	var u: Dictionary = data.unit_defs("ru")
	print("units: ", u.size(), "  mbt: ", u["mbt"]["name"], " cost ", u["mbt"]["cost"])
	print("buildings: ", data.building_defs().size(), "  vs cannon/heavy: ", data.vs("cannon", "heavy"))
	var t: Texture2D = data.tex(data.unit_art("nato", "mbt")["sheets"]["hull"]["file"])
	print("hull sheet: ", t.get_size() if t else "FEHLT")
	print("sound events: ", root.get_node("Sound").events.size())
	return true
