class_name Menu
extends Control
## The main menu: the logo, the choice of side, difficulty, map, hour, weather and map number.

signal start(opts: Dictionary)

var opts := {"faction": "nato", "difficulty": 1, "mapType": "land", "tod": "day", "weather": "clouds", "seed": 0}
var _seed_edit: LineEdit
var _groups := {}

const CHOICES := [
	["faction", "Seite", [["nato", "NATO"], ["ru", "Russland"]]],
	["difficulty", "Schwierigkeit", [[0, "Leicht"], [1, "Normal"], [2, "Schwer"]]],
	["mapType", "Karte", [["land", "Binnenland"], ["coast", "Küste"], ["lakes", "Seenplatte"]]],
	["tod", "Tageszeit", [["day", "Tag"], ["dusk", "Abend"], ["night", "Nacht"]]],
	["weather", "Wetter", [["clear", "Klar"], ["clouds", "Bewölkt"], ["rain", "Regen"]]],
]


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	var k := UiTheme.scale_for(get_viewport_rect().size)
	theme = UiTheme.make(k)
	opts["seed"] = randi_range(1, 99999)
	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(center)
	var panel := PanelContainer.new()
	center.add_child(panel)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 6 * k)
	panel.add_child(box)
	var logo := TextureRect.new()
	logo.texture = Data.tex(Data.manifest.get("title", {}).get("file", "ui/title.png"))
	logo.stretch_mode = TextureRect.STRETCH_KEEP_CENTERED
	logo.custom_minimum_size = Vector2(0, 70 * k)
	box.add_child(logo)
	var sub := Label.new()
	sub.text = "NATO gegen Russland · Echtzeit-Strategie"
	sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(sub)
	for c in CHOICES:
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 3 * k)
		var l := Label.new()
		l.text = c[1]
		l.custom_minimum_size = Vector2(70 * k, 0)
		row.add_child(l)
		var group := ButtonGroup.new()
		_groups[c[0]] = group
		for o in c[2]:
			var b := Button.new()
			b.text = o[1]
			b.toggle_mode = true
			b.button_group = group
			b.button_pressed = opts[c[0]] == o[0]
			b.pressed.connect(func(): opts[c[0]] = o[0])
			row.add_child(b)
		box.add_child(row)
	var srow := HBoxContainer.new()
	var sl := Label.new()
	sl.text = "Kartennummer"
	sl.custom_minimum_size = Vector2(70 * k, 0)
	srow.add_child(sl)
	_seed_edit = LineEdit.new()
	_seed_edit.text = str(opts["seed"])
	_seed_edit.custom_minimum_size = Vector2(60 * k, 0)
	srow.add_child(_seed_edit)
	var rnd := Button.new()
	rnd.text = "Zufall"
	rnd.pressed.connect(func(): _seed_edit.text = str(randi_range(1, 99999)))
	srow.add_child(rnd)
	box.add_child(srow)
	var go := Button.new()
	go.text = "Gefecht beginnen"
	go.custom_minimum_size = Vector2(0, 22 * k)
	go.pressed.connect(_go)
	box.add_child(go)


func _go() -> void:
	opts["seed"] = clampi(int(_seed_edit.text), 1, 99999)
	start.emit(opts.duplicate())
