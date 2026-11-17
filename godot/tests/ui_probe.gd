extends Node

func run(_args: PackedStringArray) -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	var b := Button.new()
	b.text = "X"
	b.position = Vector2(100, 100)
	b.size = Vector2(100, 50)
	layer.add_child(b)
	var hits := [0]
	b.pressed.connect(func(): hits[0] += 1)
	await get_tree().process_frame
	var t := InputEventScreenTouch.new()
	t.position = Vector2(150, 125)
	t.pressed = true
	Input.parse_input_event(t)
	await get_tree().process_frame
	var u := t.duplicate()
	u.pressed = false
	Input.parse_input_event(u)
	await get_tree().process_frame
	await get_tree().process_frame
	print("touch presses: ", hits[0])
	var m := InputEventMouseButton.new()
	m.position = Vector2(150, 125)
	m.button_index = MOUSE_BUTTON_LEFT
	m.pressed = true
	Input.parse_input_event(m)
	await get_tree().process_frame
	var mu := m.duplicate()
	mu.pressed = false
	Input.parse_input_event(mu)
	await get_tree().process_frame
	print("after mouse: ", hits[0])
