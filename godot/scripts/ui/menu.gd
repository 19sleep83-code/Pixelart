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
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var k := UiTheme.scale_for(get_viewport_rect().size)
	theme = UiTheme.make(k)
	opts["seed"] = randi_range(1, 99999)
	# the last choices (the prototype keeps them in localStorage)
	for c in CHOICES:
		var v: Variant = Settings.get_value("menu", c[0], opts[c[0]])
		for o in c[2]:
			if typeof(o[0]) == typeof(v) and o[0] == v:
				opts[c[0]] = v
	var center := CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(center)
	var panel := PanelContainer.new()
	center.add_child(panel)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 6 * k)
	panel.add_child(box)
	var logo := TextureRect.new()
	var title := Data.tex(Data.manifest.get("title", {}).get("file", "ui/title.png"))
	# only the lettering (the picture has room around it for the glow)
	var used := title.get_image().get_used_rect() if title else Rect2i()
	if used.has_area():
		var at := AtlasTexture.new()
		at.atlas = title
		at.region = Rect2(used.grow(2))
		logo.texture = at
	else:
		logo.texture = title
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
	go.focus_mode = Control.FOCUS_NONE
	box.add_child(go)
	# the controls, folded away like the prototype's <details>
	var help_btn := Button.new()
	help_btn.text = "Steuerung"
	help_btn.toggle_mode = true
	help_btn.focus_mode = Control.FOCUS_NONE
	box.add_child(help_btn)
	var help := Label.new()
	help.text = HELP_TOUCH if UiTheme.is_touch() else HELP
	help.add_theme_font_size_override("font_size", 6 * k)
	help.add_theme_color_override("font_color", UiTheme.DIM)
	help.visible = false
	box.add_child(help)
	help_btn.toggled.connect(func(on: bool) -> void: help.visible = on)


const HELP := """Linksklick / Rahmen ziehen – auswählen (Umschalt: hinzufügen, Doppelklick: alle gleichen im Bild)
Rechtsklick – bewegen, angreifen, Erz abbauen, Haus besetzen, Sammelpunkt setzen
Rechtsklick aufs eigene Landungsschiff – einsteigen · D – entladen / Haus räumen
A + Linksklick – Angriffsbewegung · S – Stopp
F1–F5, Tab – Baureiter · Y X C V B N M , . - – Felder im Baumenü (Rechtsklick: abbrechen)
Strg + 1–9 – Gruppe bilden · 1–9 – Gruppe wählen (zweimal: hinspringen)
Q – ganze Armee · E – Kampfeinheiten im Bild · Leertaste – zur Auswahl · H – Hauptquartier
Pfeiltasten, Bildschirmrand, mittlere Maustaste – Ansicht · Mausrad – Zoom · P – Pause"""
const HELP_TOUCH := """Tippen – auswählen (zweimal: alle gleichen im Bild)
Mit Auswahl tippen – bewegen, angreifen, Erz abbauen, Haus besetzen, Sammelpunkt
Lange drücken – Angriffsbewegung
Rahmen-Knopf – mit einem Finger mehrere auswählen · X-Knopf – abwählen
Ein Finger ziehen – Karte schieben · zwei Finger – zoomen
Baumenü lange drücken – Auftrag abbrechen"""


func _go() -> void:
	opts["seed"] = clampi(int(_seed_edit.text), 1, 99999)
	for c in CHOICES:
		Settings.set_value("menu", c[0], opts[c[0]])
	start.emit(opts.duplicate())
