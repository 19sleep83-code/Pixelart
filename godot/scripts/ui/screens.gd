class_name BattleScreens
extends Control
## The pause menu and the end screen over a running battle (src/main.ts, index.html #pause and #end):
## a dark veil with a panel in the middle.

signal resume
signal restart
signal quit

var k := 2
var _panel: PanelContainer
var _box: VBoxContainer
var mode := ""  # "" | pause | end


func setup(scale_k: int) -> void:
	k = scale_k
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	theme = UiTheme.make(k)
	mouse_filter = Control.MOUSE_FILTER_STOP
	var veil := ColorRect.new()
	veil.color = Color(8 / 255.0, 10 / 255.0, 6 / 255.0, 0.6)
	veil.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	veil.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(veil)
	var center := CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(center)
	_panel = PanelContainer.new()
	center.add_child(_panel)
	_box = VBoxContainer.new()
	_box.add_theme_constant_override("separation", UiTheme.px(10, k))
	_box.custom_minimum_size = Vector2(UiTheme.px(320, k), 0)
	_panel.add_child(_box)
	visible = false


func _title(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.uppercase = true
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.add_theme_font_override("font", UiTheme.stencil())
	l.add_theme_font_size_override("font_size", UiTheme.px(30, k))
	l.add_theme_color_override("font_color", UiTheme.BRASS)
	return l


func _btn(text: String, big: bool, fn: Callable, id: String) -> Button:
	var b := Button.new()
	b.text = text
	b.name = id
	b.focus_mode = Control.FOCUS_NONE
	b.custom_minimum_size = Vector2(0, UiTheme.px(44 if big else 34, k))
	if big:
		b.add_theme_font_size_override("font_size", UiTheme.px(17, k))
	b.pressed.connect(fn)
	_box.add_child(b)
	return b


func _clear() -> void:
	for c in _box.get_children():
		_box.remove_child(c)
		c.queue_free()


func show_pause() -> void:
	_clear()
	mode = "pause"
	_box.add_child(_title("Pause"))
	_btn("Weiter", true, func() -> void: resume.emit(), "Resume")
	var snd := CheckBox.new()
	snd.text = "Ton"
	snd.focus_mode = Control.FOCUS_NONE
	snd.button_pressed = Sound.enabled
	snd.toggled.connect(func(on: bool) -> void:
		Sound.enabled = on
		Settings.set_value("audio", "sound", on))
	_box.add_child(snd)
	_btn("Neues Gefecht, gleiche Einstellungen", false, func() -> void: restart.emit(), "Restart")
	_btn("Zum Hauptmenü", false, func() -> void: quit.emit(), "Quit")
	visible = true


func show_end(g: Game) -> void:
	_clear()
	mode = "end"
	var win := g.over == 1
	_box.add_child(_title("Sieg" if win else "Niederlage"))
	var me := g.players[0]
	var foe := g.players[1]
	var grid := GridContainer.new()
	grid.columns = 3
	grid.add_theme_constant_override("h_separation", UiTheme.px(18, k))
	grid.add_theme_constant_override("v_separation", UiTheme.px(4, k))
	var t := floori(g.time)
	var rows := [
		["", "NATO" if me.faction == "nato" else "Russland", "NATO" if foe.faction == "nato" else "Russland"],
		["Zerstört", str(me.stats.killed), str(foe.stats.killed)],
		["Verloren", str(me.stats.lost), str(foe.stats.lost)],
		["Gebäude gebaut", str(me.stats.built), str(foe.stats.built)],
		["Erz gefördert", str(int(Rng.js_round(me.stats.harvested))), str(int(Rng.js_round(foe.stats.harvested)))],
		["Dauer", "%d:%02d" % [t / 60, t % 60], ""],
	]
	for ri in rows.size():
		for ci in 3:
			var l := Label.new()
			l.text = rows[ri][ci]
			if ri == 0:
				l.add_theme_color_override("font_color", UiTheme.BRASS)
				l.add_theme_font_override("font", UiTheme.stencil())
			elif ci == 0:
				l.add_theme_color_override("font_color", UiTheme.DIM)
			if ci > 0:
				l.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
				l.custom_minimum_size = Vector2(UiTheme.px(70, k), 0)
			grid.add_child(l)
	var c := CenterContainer.new()
	c.add_child(grid)
	_box.add_child(c)
	_btn("Nochmal", true, func() -> void: restart.emit(), "Again")
	_btn("Zum Hauptmenü", false, func() -> void: quit.emit(), "EndMenu")
	visible = true


func hide_all() -> void:
	mode = ""
	visible = false


func _unhandled_input(ev: InputEvent) -> void:
	# Esc (or the back button) on the pause menu: back to the battle
	if visible and mode == "pause" and ev is InputEventKey and ev.pressed and not ev.echo and ev.keycode == KEY_ESCAPE:
		resume.emit()
		get_viewport().set_input_as_handled()
