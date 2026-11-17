class_name Hud
extends Control
## The interface of a battle (port of src/ui/hud.ts and the top bar of index.html): the menu button,
## clock and unit count at the top, the radio log at the bottom, and the command bar on the right,
## styled like a field command post: money and power, the situation map, the build menus with hotkeys
## and data cards, the selection. On touch screens two more buttons: box select and deselect.
##
## Sizes follow the prototype's CSS (300 px wide bar …) at UI scale 2; `k` = 3 makes everything
## half as large again (phones).

signal menu_pressed

## the item hotkeys: physical keys (German labels as in the prototype)
const KEYS := [[KEY_Z, "Y"], [KEY_X, "X"], [KEY_C, "C"], [KEY_V, "V"], [KEY_B, "B"], [KEY_N, "N"], [KEY_M, "M"], [KEY_COMMA, ","], [KEY_PERIOD, "."], [KEY_SLASH, "-"]]
const TAB_KEYS := {KEY_F1: "build", KEY_F2: "inf", KEY_F3: "veh", KEY_F4: "air", KEY_F5: "sea"}
const TAB_LABEL := {"build": "Bau", "inf": "Inf.", "veh": "Fahrz.", "air": "Luft", "sea": "See"}
const TAB_NAME := {"build": "Bau", "inf": "Infanterie", "veh": "Fahrzeuge", "air": "Luft", "sea": "See"}
const HINT := "Linksklick oder Rahmen: auswählen\nRechtsklick: bewegen / angreifen\nA: Angriffsbewegung · S: Stopp\nRechtsklick auf Haus: besetzen · D: räumen\nStrg+1–9: Gruppe · H: Hauptquartier"
const HINT_TOUCH := "Tippen: auswählen\nMit Auswahl tippen: bewegen / angreifen\nLange drücken: Angriffsbewegung\nRahmen-Knopf: mehrere wählen\nZwei Finger: zoomen"

var game: Game
var world: World
var input: PlayerInput
var k := 2
var touch := false
var tab := "build"

var _side: PanelContainer
var _credits: Label
var _power: Control
var _power_text: Label
var _mini: MiniMap
var _tabs := {}  # queue -> Button
var _grid: GridContainer
var _grid_scroll: ScrollContainer
var _btns: Array = []  # of Dictionary {el, key, q, bar, badge, state, name, cost}
var _sel_box: VBoxContainer
var _sel_key := "-"
var _sel_hp: Control
var _sel_hpt: Label
var _sel_extra: Label
var _card: PanelContainer
var _card_for: Control
var _radio: VBoxContainer
var _msg_key := ""
var _clock: Label
var _count: Label
var _box_btn: Button
var _desel_btn: Button
var _touch_bar: VBoxContainer
var _tick := 0
var _frames := 0
var _blink := false
var _icons := {}
var _press_t := {}


func px(css: float) -> int:
	return UiTheme.px(css, k)


func setup(g: Game, w: World, inp: PlayerInput, scale_k: int, is_touch: bool) -> void:
	game = g
	world = w
	input = inp
	k = scale_k
	touch = is_touch
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	theme = UiTheme.make(k)
	var f := g.me.faction
	for key in ["hq"] + Data.BUILD_ORDER:
		_icons["b:" + key] = Data.tex(Data.building_art(f, key).get("icon", ""))
	for key in Data.UNIT_ORDER:
		var a := Data.unit_art(f, key)
		if a.has("icon"):
			_icons["u:" + key] = Data.tex(a["icon"])
	_build_top()
	_build_radio()
	_build_side()
	if touch:
		_build_touch()
	_build_card()
	input.changed.connect(func() -> void:
		_sel_key = "-"
		update(true))
	set_tab("build")
	world.view_inset_right = side_width()


## the width of the command bar in screen pixels
func side_width() -> float:
	return float(px(300))


func _icon(key: String) -> Texture2D:
	return _icons.get(key)


static func _clock_text(t: float) -> String:
	var s := floori(t)
	return "%d:%02d" % [s / 60, s % 60]


func _label(text: String, size_css: float, col := UiTheme.LIGHT, stencil := false) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", px(size_css))
	l.add_theme_color_override("font_color", col)
	if stencil:
		l.add_theme_font_override("font", UiTheme.stencil())
		l.uppercase = true
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l


func _plate(child: Control) -> PanelContainer:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", UiTheme.flat(Color(30 / 255.0, 36 / 255.0, 24 / 255.0, 0.9), UiTheme.EDGE, px(2), [px(8), px(4), px(8), px(4)]))
	p.add_child(child)
	return p


## a button without keyboard focus (so Space, Tab and the arrows stay with the game)
func _button(text := "", icon_key := "") -> Button:
	var b := Button.new()
	b.text = text
	b.focus_mode = Control.FOCUS_NONE
	if icon_key != "":
		b.icon = UiTheme.icon(icon_key, maxi(1, k - 1) if text != "" else k)
	return b


# ─────────────────────────────────────────────────────────────── building the panels

func _build_top() -> void:
	var bar := HBoxContainer.new()
	bar.position = Vector2(px(8), px(8))
	bar.add_theme_constant_override("separation", px(6))
	bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(bar)
	var menu := _button("Menü", "menu")
	menu.tooltip_text = "Pause und Menü (P)"
	menu.add_theme_font_size_override("font_size", px(14))
	menu.pressed.connect(func() -> void: menu_pressed.emit())
	menu.name = "MenuButton"
	bar.add_child(menu)
	_clock = _label("0:00", 14)
	bar.add_child(_plate(_clock))
	_count = _label("Einheiten 0", 14)
	bar.add_child(_plate(_count))
	for c in bar.get_children():
		if c is PanelContainer:
			c.mouse_filter = Control.MOUSE_FILTER_IGNORE


func _build_radio() -> void:
	_radio = VBoxContainer.new()
	_radio.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_radio.add_theme_constant_override("separation", px(3))
	_radio.anchor_top = 1.0
	_radio.anchor_bottom = 1.0
	_radio.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_radio.offset_left = px(10)
	_radio.offset_bottom = -px(10)
	add_child(_radio)


func _build_touch() -> void:
	_touch_bar = VBoxContainer.new()
	_touch_bar.add_theme_constant_override("separation", px(8))
	_touch_bar.anchor_left = 1.0
	_touch_bar.anchor_right = 1.0
	_touch_bar.anchor_top = 1.0
	_touch_bar.anchor_bottom = 1.0
	_touch_bar.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	_touch_bar.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_touch_bar.offset_right = -side_width() - px(12)
	_touch_bar.offset_bottom = -px(12)
	_touch_bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_touch_bar)
	_box_btn = _button("", "box_select")
	_box_btn.toggle_mode = true
	_box_btn.tooltip_text = "Rahmen ziehen"
	_box_btn.custom_minimum_size = Vector2(px(56), px(56))
	_box_btn.icon_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_box_btn.toggled.connect(func(on: bool) -> void: input.box_mode = on)
	_box_btn.name = "BoxSelect"
	_touch_bar.add_child(_box_btn)
	_desel_btn = _button("", "deselect")
	_desel_btn.tooltip_text = "Abwählen"
	_desel_btn.custom_minimum_size = Vector2(px(56), px(56))
	_desel_btn.icon_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_desel_btn.pressed.connect(func() -> void:
		input.place = ""
		input.attack_mode = false
		input.set_sel([]))
	_desel_btn.name = "Deselect"
	_touch_bar.add_child(_desel_btn)


func _build_side() -> void:
	_side = PanelContainer.new()
	_side.name = "Side"
	_side.anchor_left = 1.0
	_side.anchor_right = 1.0
	_side.anchor_bottom = 1.0
	_side.offset_left = -side_width()
	_side.mouse_filter = Control.MOUSE_FILTER_STOP
	var bg := UiTheme.flat(Color("2c3423"), Color("0c0f09"), [px(3), 0, 0, 0], [px(12), px(12), px(12), px(10)])
	bg.bg_color = UiTheme.PLATE2.lerp(UiTheme.PLATE, 0.5)
	_side.add_theme_stylebox_override("panel", bg)
	add_child(_side)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", px(8))
	_side.add_child(col)
	# the plate: command post and side
	var head := HBoxContainer.new()
	head.add_child(_label("Gefechtsstand", 13, UiTheme.BRASS, true))
	var sp := Control.new()
	sp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(sp)
	var chip := PanelContainer.new()
	var nato := game.me.faction == "nato"
	chip.add_theme_stylebox_override("panel", UiTheme.flat(UiTheme.BLUE if nato else Color("c8382c"), Color(0, 0, 0, 0.5), px(1), [px(8), px(1), px(8), px(1)]))
	chip.add_child(_label("NATO" if nato else "Russland", 12, Color.WHITE, true))
	chip.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	head.add_child(chip)
	col.add_child(head)
	var rule := ColorRect.new()
	rule.color = Color("1a1f14")
	rule.custom_minimum_size = Vector2(0, px(2))
	col.add_child(rule)
	# money and power
	var money := HBoxContainer.new()
	var ml := _label("Rohstoffe", 11, UiTheme.DIM, true)
	ml.custom_minimum_size = Vector2(px(80), 0)
	money.add_child(ml)
	var led := PanelContainer.new()
	led.add_theme_stylebox_override("panel", UiTheme.flat(UiTheme.INK, Color("050604"), px(2), [px(8), 0, px(8), 0]))
	led.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_credits = _label("00000", 22, UiTheme.AMBER, true)
	_credits.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_credits.add_theme_color_override("font_shadow_color", Color(1, 0.67, 0.2, 0.35))
	_credits.add_theme_constant_override("shadow_outline_size", px(3))
	led.add_child(_credits)
	money.add_child(led)
	col.add_child(money)
	var power := HBoxContainer.new()
	power.add_theme_constant_override("separation", px(6))
	var pl := _label("Strom", 11, UiTheme.DIM, true)
	pl.custom_minimum_size = Vector2(px(74), 0)
	power.add_child(pl)
	_power = Control.new()
	_power.custom_minimum_size = Vector2(0, px(16))
	_power.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_power.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_power.draw.connect(_draw_power)
	power.add_child(_power)
	_power_text = _label("0/0", 12, UiTheme.DIM)
	_power_text.custom_minimum_size = Vector2(px(56), 0)
	_power_text.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	power.add_child(_power_text)
	col.add_child(power)
	# the situation map
	var frame := PanelContainer.new()
	frame.add_theme_stylebox_override("panel", UiTheme.flat(Color("0b0d09"), Color("050604"), px(2), px(2)))
	var outer := PanelContainer.new()
	outer.add_theme_stylebox_override("panel", UiTheme.flat(UiTheme.EDGE, UiTheme.EDGE, 0, px(2)))
	outer.add_child(frame)
	_mini = MiniMap.new()
	_mini.name = "MiniMap"
	var mw := side_width() - px(24) - px(8) - px(3)
	_mini.custom_minimum_size = Vector2(mw, roundf(mw / 2.0))
	_mini.setup(game, world, input, k)
	frame.add_child(_mini)
	var lbl := PanelContainer.new()
	lbl.add_theme_stylebox_override("panel", UiTheme.flat(UiTheme.PLATE3, Color.TRANSPARENT, 0, [px(6), 0, px(6), 0]))
	lbl.add_child(_label("Lagekarte", 10, UiTheme.BRASS, true))
	lbl.mouse_filter = Control.MOUSE_FILTER_IGNORE
	lbl.size_flags_horizontal = Control.SIZE_SHRINK_END
	lbl.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	frame.add_child(lbl)
	col.add_child(outer)
	# the tabs
	var tabs := HBoxContainer.new()
	tabs.add_theme_constant_override("separation", px(3))
	for q in Data.QUEUES:
		var b := _button()
		b.toggle_mode = true
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.custom_minimum_size = Vector2(0, px(34))
		b.tooltip_text = "%s (F%d)" % [TAB_NAME[q], Data.QUEUES.find(q) + 1]
		b.name = "Tab_" + q
		var v := VBoxContainer.new()
		v.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		v.alignment = BoxContainer.ALIGNMENT_CENTER
		v.add_theme_constant_override("separation", 0)
		v.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var t := _label(TAB_LABEL[q], 10, UiTheme.LIGHT, true)
		t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		v.add_child(t)
		var kb := _label("F%d" % (Data.QUEUES.find(q) + 1), 9, UiTheme.DIM)
		kb.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		v.add_child(kb)
		b.add_child(v)
		b.set_meta("label", t)
		var bar := ColorRect.new()
		bar.anchor_top = 1.0
		bar.anchor_right = 1.0
		bar.anchor_bottom = 1.0
		bar.offset_top = -px(3) - px(2)
		bar.offset_bottom = -px(2)
		bar.offset_left = px(2)
		bar.offset_right = -px(2)
		bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
		bar.visible = false
		b.add_child(bar)
		b.set_meta("bar", bar)
		b.pressed.connect(func() -> void: set_tab(q))
		tabs.add_child(b)
		_tabs[q] = b
	col.add_child(tabs)
	# the items
	_grid_scroll = ScrollContainer.new()
	_grid_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_grid_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_grid_scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_SHOW_NEVER
	_grid = GridContainer.new()
	_grid.columns = 3
	_grid.add_theme_constant_override("h_separation", px(4))
	_grid.add_theme_constant_override("v_separation", px(4))
	_grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_grid_scroll.add_child(_grid)
	col.add_child(_grid_scroll)
	# the selection
	var sel := PanelContainer.new()
	sel.name = "Selection"
	sel.add_theme_stylebox_override("panel", UiTheme.flat(Color("151a11"), Color("050604"), px(2), [px(8), px(6), px(8), px(8)]))
	sel.custom_minimum_size = Vector2(0, px(132))
	var sel_out := PanelContainer.new()
	sel_out.add_theme_stylebox_override("panel", UiTheme.flat(UiTheme.EDGE, UiTheme.EDGE, 0, px(2)))
	sel_out.add_child(sel)
	_sel_box = VBoxContainer.new()
	_sel_box.add_theme_constant_override("separation", px(3))
	sel.add_child(_sel_box)
	col.add_child(sel_out)


func _build_card() -> void:
	_card = PanelContainer.new()
	_card.name = "Card"
	_card.add_theme_stylebox_override("panel", UiTheme.flat(Color("222919"), UiTheme.EDGE2, px(2), [px(10), px(8), px(10), px(8)]))
	_card.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_card.custom_minimum_size = Vector2(px(250), 0)
	_card.visible = false
	add_child(_card)


# ─────────────────────────────────────────────────────────────── tabs and items

func _has_queue(q: String) -> bool:
	var g := game
	if q == "build":
		return g.has_building(0, "hq")
	for key in Data.UNIT_ORDER:
		var d: Variant = g.me.units.get(key)
		if d and d["queue"] == q and g.has_building(0, d["producer"]):
			return true
	return false


func _keys_of(q: String) -> Array:
	if q == "build":
		return Data.BUILD_ORDER.duplicate()
	var out := []
	for key in Data.UNIT_ORDER:
		var d: Variant = game.me.units.get(key)
		if d and d["queue"] == q:
			out.append(key)
	return out


func set_tab(q: String) -> void:
	tab = q
	for t in _tabs:
		_tabs[t].button_pressed = t == q
	for c in _grid.get_children():
		c.queue_free()
		_grid.remove_child(c)
	_btns.clear()
	_card_hide()
	var keys := _keys_of(q)
	for i in keys.size():
		var key: String = keys[i]
		var def: Dictionary = game.bdefs[key] if q == "build" else game.me.units[key]
		_btns.append(_item(key, q, def, KEYS[i][1] if i < KEYS.size() else ""))
	_grid_scroll.scroll_vertical = 0
	update(true)


func _item(key: String, q: String, def: Dictionary, hk: String) -> Dictionary:
	var el := Button.new()
	el.focus_mode = Control.FOCUS_NONE
	el.name = "Item_" + key
	el.custom_minimum_size = Vector2(0, px(80))
	el.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	el.clip_contents = true
	var base := UiTheme.flat(Color("171c13"), Color("2a3320"), px(2))
	el.add_theme_stylebox_override("normal", base)
	el.add_theme_stylebox_override("pressed", base)
	el.add_theme_stylebox_override("hover", UiTheme.flat(Color("1d2418"), UiTheme.EDGE2, px(2)))
	el.add_theme_stylebox_override("hover_pressed", UiTheme.flat(Color("1d2418"), UiTheme.EDGE2, px(2)))
	var img := TextureRect.new()
	img.texture = _icon(("b:" if q == "build" else "u:") + key)
	img.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	img.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	img.anchor_right = 1.0
	img.offset_top = px(4)
	img.offset_bottom = px(48)
	img.offset_left = px(4)
	img.offset_right = -px(4)
	img.mouse_filter = Control.MOUSE_FILTER_IGNORE
	el.add_child(img)
	var bot := VBoxContainer.new()
	bot.anchor_top = 1.0
	bot.anchor_right = 1.0
	bot.anchor_bottom = 1.0
	bot.grow_vertical = Control.GROW_DIRECTION_BEGIN
	bot.offset_bottom = -px(2)
	bot.add_theme_constant_override("separation", 0)
	bot.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var nm := _label(String(def.get("name", key)), 10)
	nm.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	nm.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	nm.clip_text = true
	bot.add_child(nm)
	var cost := _label(str(int(def.get("cost", 0))), 11, UiTheme.AMBER)
	cost.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	bot.add_child(cost)
	var bar := ColorRect.new()
	bar.color = Color(8 / 255.0, 10 / 255.0, 6 / 255.0, 0.66)
	bar.anchor_right = 1.0
	bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
	bar.visible = false
	var line := ColorRect.new()
	line.color = Color("8fe060")
	line.anchor_top = 1.0
	line.anchor_right = 1.0
	line.anchor_bottom = 1.0
	line.offset_top = -maxf(1, px(1))
	bar.add_child(line)
	el.add_child(bot)
	el.add_child(bar)
	var badge := _label("", 13, Color.WHITE)
	badge.anchor_left = 1.0
	badge.anchor_right = 1.0
	badge.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	badge.offset_right = -px(4)
	badge.offset_top = px(1)
	badge.add_theme_color_override("font_outline_color", Color.BLACK)
	badge.add_theme_constant_override("outline_size", px(3))
	el.add_child(badge)
	var state := _label("", 12, UiTheme.BRASS, true)
	state.anchor_right = 1.0
	state.offset_top = px(18)
	state.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	state.add_theme_color_override("font_outline_color", Color.BLACK)
	state.add_theme_constant_override("outline_size", px(3))
	el.add_child(state)
	if hk != "" and not touch:
		var kb := PanelContainer.new()
		kb.add_theme_stylebox_override("panel", UiTheme.flat(UiTheme.PLATE3, UiTheme.EDGE, maxi(1, px(1)), [px(3), 0, px(3), 0]))
		kb.position = Vector2(px(3), px(3))
		kb.mouse_filter = Control.MOUSE_FILTER_IGNORE
		kb.add_child(_label(hk, 9, UiTheme.DIM))
		el.add_child(kb)
	el.pressed.connect(func() -> void:
		if _press_t.get("skip", false):
			_press_t["skip"] = false
			return
		click(key, q))
	el.gui_input.connect(func(ev: InputEvent) -> void: _item_input(ev, key, q))
	el.mouse_entered.connect(func() -> void: _show_card(def, q == "build", el))
	el.mouse_exited.connect(func() -> void: _card_hide())
	_grid.add_child(el)
	return {"el": el, "key": key, "q": q, "bar": bar, "badge": badge, "state": state}


## right click (or a long press on a touch screen): cancel one of that item
func _item_input(ev: InputEvent, key: String, q: String) -> void:
	if ev is InputEventMouseButton and ev.pressed and ev.button_index == MOUSE_BUTTON_RIGHT:
		cancel(key, q)
		accept_event()
	elif ev is InputEventScreenTouch:
		if ev.pressed:
			_press_t[key] = Time.get_ticks_msec()
		elif Time.get_ticks_msec() - int(_press_t.get(key, 1 << 40)) > PlayerInput.LONG_MS:
			_press_t["skip"] = true
			cancel(key, q)


func cancel(key: String, q: String) -> void:
	game.cancel_item(0, q, key)
	if input.place == key:
		input.place = ""
	update(true)


## left click on an item: queue it, or place a finished building
func click(key: String, q: String) -> void:
	var g := game
	if q == "build":
		var list: Array = g.me.queues["build"]
		var it: Game.QItem = list[0] if not list.is_empty() else null
		if it and it.ready and it.key == key:
			input.place = key
			input.attack_mode = false
			input.changed.emit()
		elif it == null:
			if not g.queue_item(0, "build", key):
				_need(g.bdefs[key]["req"])
		else:
			g.msg("Es wird schon ein Gebäude gebaut", "warn")
	elif not g.queue_item(0, q, key):
		_need(g.me.units[key]["req"])
	update(true)


func _need(req: Array) -> void:
	var miss := game.missing(0, req)
	if not miss.is_empty():
		var names := []
		for m in miss:
			names.append(game.bdefs[m]["name"])
		game.msg("Benötigt: " + ", ".join(names), "warn")


## the keys of the command bar (tabs and items); true if used
func hotkey(e: InputEventKey) -> bool:
	if TAB_KEYS.has(e.keycode):
		set_tab(TAB_KEYS[e.keycode])
		return true
	if e.keycode == KEY_TAB:
		var i := Data.QUEUES.find(tab)
		var n := Data.QUEUES.size()
		set_tab(Data.QUEUES[(i + (n - 1 if e.shift_pressed else 1)) % n])
		return true
	var code := e.physical_keycode if e.physical_keycode != KEY_NONE else e.keycode
	for i in KEYS.size():
		if KEYS[i][0] == code and i < _btns.size():
			click(_btns[i]["key"], _btns[i]["q"])
			return true
	return false


# ─────────────────────────────────────────────────────────────── the data card

static func _targets(w: Dictionary) -> String:
	var t := []
	if w.get("ground", false):
		t.append("Boden")
	if w.get("sea", w.get("ground", false)):
		t.append("See")
	if w.get("air", false):
		t.append("Luft")
	return " · ".join(t)


static func _num(v: Variant) -> String:
	var f := float(v)
	return str(int(f)) if f == floorf(f) else str(f)


func _show_card(def: Dictionary, building: bool, at: Control) -> void:
	for c in _card.get_children():
		c.queue_free()
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", px(4))
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_card.add_child(box)
	var head := VBoxContainer.new()
	head.add_theme_constant_override("separation", 0)
	head.add_child(_label(String(def.get("name", "")), 13, UiTheme.BRASS, true))
	if not building:
		head.add_child(_label(String(def.get("role", "")), 11, UiTheme.DIM))
	box.add_child(head)
	var dash := ColorRect.new()
	dash.color = UiTheme.EDGE2
	dash.custom_minimum_size = Vector2(0, maxf(1, px(1)))
	box.add_child(dash)
	var desc := _label(String(def.get("desc", "")), 12)
	desc.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	desc.custom_minimum_size = Vector2(px(230), 0)
	box.add_child(desc)
	var rows := [["Kosten", str(int(def.get("cost", 0)))], ["Bauzeit", "%s s" % _num(def.get("time", 0))], ["Struktur", str(int(def.get("hp", 0)))]]
	if building:
		var pw := int(def.get("power", 0))
		rows.append(["Fläche", "%d × %d Felder" % [int(def["w"]), int(def["h"])]])
		rows.append(["Strom", ("+%d" % pw) if pw > 0 else str(pw)])
	else:
		rows.append(["Panzerung", String(Data.armor_names.get(def.get("armor", ""), def.get("armor", "")))])
		rows.append(["Tempo", "%.1f" % float(def.get("speed", 0))])
		rows.append(["Sicht", _num(def.get("sight", 0))])
		if def.get("transport", 0):
			rows.append(["Ladung", "%d Einheiten" % int(def["transport"])])
		if def.get("carrier", 0):
			rows.append(["Jets an Bord", str(int(def["carrier"]))])
	var w: Variant = def.get("weapon")
	if w is Dictionary:
		var burst := int(w.get("burst", 1))
		rows.append(["Schaden", "%s%s%s" % [_num(w.get("dmg", 0)), (" × %d" % burst) if burst > 1 else "", " (Fläche)" if w.get("splash", 0) else ""]])
		rows.append(["Reichweite", "%s%s" % [_num(w.get("range", 0)), (" (min. %s)" % _num(w["minRange"])) if w.get("minRange", 0) else ""]])
		rows.append(["Nachladen", "%s s" % _num(w.get("reload", 0))])
		rows.append(["Ziele", _targets(w)])
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", px(10))
	grid.add_theme_constant_override("v_separation", px(1))
	for r in rows:
		grid.add_child(_label(r[0], 12, UiTheme.DIM))
		var v := _label(r[1], 12)
		v.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		grid.add_child(v)
	box.add_child(grid)
	var miss := game.missing(0, def.get("req", []))
	if not miss.is_empty():
		var names := []
		for m in miss:
			names.append(game.bdefs.get(m, {}).get("name", m))
		var need := _label("Benötigt: " + ", ".join(names), 12, UiTheme.RED)
		need.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		need.custom_minimum_size = Vector2(px(230), 0)
		box.add_child(need)
	_card_for = at
	_card.visible = true
	_card.reset_size()
	_place_card.call_deferred()


func _place_card() -> void:
	if not _card.visible or not is_instance_valid(_card_for):
		return
	_card.reset_size()
	var r := _card_for.get_global_rect()
	var h := get_viewport_rect().size.y
	var y := clampf(r.position.y - px(10), px(8), h - _card.size.y - px(8))
	_card.position = Vector2(_side.get_global_rect().position.x - px(8) - _card.size.x, y)


func _card_hide() -> void:
	_card.visible = false
	_card_for = null


## the data card shown now (tests)
func card_visible() -> bool:
	return _card.visible


# ─────────────────────────────────────────────────────────────── every frame

func _process(_dt: float) -> void:
	if not game:
		return
	_frames += 1
	_blink = (Time.get_ticks_msec() / 400) % 2 == 0
	update()
	if _frames % 4 == 0:
		_mini.refresh()


func update(force := false) -> void:
	_tick += 1
	if not force and _tick % 6:
		return
	var g := game
	var me := g.me
	_credits.text = "%05d" % floori(me.credits)
	var low := me.power_use > me.power_prod
	_power_text.text = "%d/%d" % [me.power_use, me.power_prod]
	_power_text.add_theme_color_override("font_color", UiTheme.RED if low else UiTheme.DIM)
	_power.queue_redraw()
	_clock.text = _clock_text(g.time)
	var n := 0
	for e in g.ents:
		if e.owner == 0 and not e.is_b:
			n += 1
	_count.text = "Einheiten %d" % n
	# which tabs have a producer
	var sea := g.map.type != "land"
	for q in _tabs:
		var b: Button = _tabs[q]
		var on: bool = _has_queue(q) and (q != "sea" or sea)
		b.modulate = Color(1, 1, 1, 1.0 if on else 0.45)
		var list: Array = me.queues[q]
		var it: Game.QItem = list[0] if not list.is_empty() else null
		var bar: ColorRect = b.get_meta("bar")
		bar.visible = it != null
		bar.color = UiTheme.BRASS if (it and it.ready) else Color("8fe060")
		var lab: Label = b.get_meta("label")
		lab.add_theme_color_override("font_color", UiTheme.BRASS if (it and it.ready and q == "build" and _blink) else (Color("fff6d8") if q == tab else UiTheme.LIGHT))
	for bt in _btns:
		var q: String = bt["q"]
		var key: String = bt["key"]
		var def: Dictionary = g.bdefs[key] if q == "build" else me.units[key]
		var miss := g.missing(0, def.get("req", []))
		var list: Array = me.queues[q]
		var count := 0
		for i in list:
			if i.key == key:
				count += 1
		var head: Game.QItem = list[0] if not list.is_empty() else null
		var active := head != null and head.key == key
		var prog := head.progress if active else 0.0
		var el: Button = bt["el"]
		var bar: ColorRect = bt["bar"]
		bar.visible = active and not head.ready
		bar.offset_bottom = roundf((1.0 - prog) * el.size.y)
		bt["badge"].text = str(count) if count > 1 else ""
		bt["state"].text = ("Bereit" if head.ready else "%d%%" % floori(prog * 100)) if active else ""
		var a := 1.0
		var tint := Color.WHITE
		if not miss.is_empty():
			a = 0.35
			tint = Color(0.75, 0.75, 0.75)
		elif q == "build" and head != null and not active:
			a = 0.55
		el.modulate = Color(tint.r, tint.g, tint.b, a)
		var border := Color("2a3320")
		if input.place == key and q == "build":
			border = Color("8fe060")
		elif active and head.ready:
			border = UiTheme.BRASS if _blink else UiTheme.EDGE
		var sb: StyleBoxFlat = el.get_theme_stylebox("normal")
		if sb.border_color != border:
			var nb := sb.duplicate()
			nb.border_color = border
			el.add_theme_stylebox_override("normal", nb)
			el.add_theme_stylebox_override("pressed", nb)
	if _box_btn and _box_btn.button_pressed != input.box_mode:
		_box_btn.set_pressed_no_signal(input.box_mode)
	_selection()
	_radio_update()


func _draw_power() -> void:
	var me := game.me
	var s := _power.size
	var b := px(2)
	var mx := float(maxi(maxi(me.power_prod, me.power_use), 100))
	var low := me.power_use > me.power_prod
	_power.draw_rect(Rect2(Vector2(0, px(2)), Vector2(s.x, s.y - px(4))), Color("050604"))
	var inner := Rect2(Vector2(b, px(2) + b), Vector2(s.x - 2 * b, s.y - px(4) - 2 * b))
	_power.draw_rect(inner, UiTheme.INK)
	var fw := inner.size.x * me.power_prod / mx
	var c1 := Color("ff7a50") if low else Color("8fe060")
	var c2 := Color("8a3a22") if low else Color("4f8a32")
	var x := 0.0
	var st := px(7)
	while x < fw:
		_power.draw_rect(Rect2(inner.position + Vector2(x, 0), Vector2(minf(px(5), fw - x), inner.size.y)), c1)
		if x + px(5) < fw:
			_power.draw_rect(Rect2(inner.position + Vector2(x + px(5), 0), Vector2(minf(px(2), fw - x - px(5)), inner.size.y)), c2)
		x += st
	var ux := inner.position.x + minf(1.0, me.power_use / mx) * inner.size.x
	_power.draw_rect(Rect2(Vector2(roundf(ux), 0), Vector2(px(2), s.y)), Color.WHITE)


func _radio_update() -> void:
	var g := game
	var key := ""
	for m in g.msgs:
		key += "%f%s|" % [m.t, m.text]
	key += str(floori(g.time))
	if key == _msg_key:
		return
	_msg_key = key
	for c in _radio.get_children():
		c.queue_free()
	var mw := px(560)
	for m in g.msgs:
		var age := g.time - m.t
		if age > 10:
			continue
		var p := PanelContainer.new()
		var col := UiTheme.RED if m.kind == "warn" else (UiTheme.GREEN if m.kind == "good" else UiTheme.BRASS)
		p.add_theme_stylebox_override("panel", UiTheme.flat(Color(10 / 255.0, 14 / 255.0, 8 / 255.0, 0.82), col, [px(3), 0, 0, 0], [px(8), px(3), px(10), px(3)]))
		p.mouse_filter = Control.MOUSE_FILTER_IGNORE
		p.modulate.a = minf(1.0, (10.0 - age) / 2.5)
		p.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", px(8))
		row.mouse_filter = Control.MOUSE_FILTER_IGNORE
		row.add_child(_label(_clock_text(m.t), 12, UiTheme.DIM))
		var ch := _label("Funk", 10, UiTheme.BRASS, true)
		ch.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(ch)
		var t := _label(m.text, 14, Color("ffd8c8") if m.kind == "warn" else Color("d8f0c8"))
		t.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		var room := minf(mw, get_viewport_rect().size.x * 0.7 - side_width()) - px(110)
		var tw := t.get_theme_font("font").get_string_size(m.text, HORIZONTAL_ALIGNMENT_LEFT, -1, px(14)).x
		t.custom_minimum_size = Vector2(minf(tw + 2, room), 0)
		row.add_child(t)
		p.add_child(row)
		_radio.add_child(p)


# ─────────────────────────────────────────────────────────────── the selection

func _rank_row(e: Ent) -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", px(4))
	if e.rank > 0:
		var r := TextureRect.new()
		r.texture = Data.tex("ui/rank_%d@%dx.png" % [mini(3, e.rank), k])
		r.stretch_mode = TextureRect.STRETCH_KEEP_CENTERED
		r.mouse_filter = Control.MOUSE_FILTER_IGNORE
		row.add_child(r)
	var names: Array = game.rank_names
	row.add_child(_label(String(names[mini(e.rank, names.size() - 1)]), 11, Color("f0c840") if e.rank >= 3 else UiTheme.DIM))
	return row


func _act(row: HFlowContainer, label: String, icon_key: String, fn: Callable, on := false) -> Button:
	var b := _button(label, icon_key)
	b.toggle_mode = true
	b.button_pressed = on
	b.add_theme_font_size_override("font_size", px(11))
	b.pressed.connect(func() -> void:
		fn.call()
		_sel_key = "-")
	b.name = "Act_" + icon_key
	row.add_child(b)
	return b


func _selection() -> void:
	var g := game
	var sel: Array[Ent] = []
	for e in input.sel:
		if not e.dead and e.carried_by == null:
			sel.append(e)
	var key := ""
	for e in sel:
		key += str(e.id) + ("i" if e.inside else "")
		if e.key == "bunker":
			var hg := g.garrison_of(e)
			key += "g%d" % (hg.occ.size() if hg else 0)
		if e.is_b:
			key += "r%d%d" % [int(e.repairing), int(g.me.primary.get(String(e.b.get("produces", "")), -1) == e.id)]
		key += ","
	if key != _sel_key:
		_sel_key = key
		_sel_hp = null
		_sel_hpt = null
		_sel_extra = null
		for c in _sel_box.get_children():
			c.queue_free()
			_sel_box.remove_child(c)
		if sel.is_empty():
			_sel_box.add_child(_label("Auswahl", 10, UiTheme.BRASS, true))
			var h := _label(HINT_TOUCH if touch else HINT, 12, UiTheme.DIM)
			h.add_theme_constant_override("line_spacing", px(3))
			_sel_box.add_child(h)
		elif sel.size() == 1:
			_one(sel[0])
		else:
			_many(sel)
	if sel.size() == 1 and _sel_hp:
		var e := sel[0]
		_sel_hp.set_meta("k", maxf(0.0, e.hp / e.max_hp))
		_sel_hp.queue_redraw()
		var t := "%d / %d" % [ceili(e.hp), int(e.max_hp)]
		if not e.is_b and e.kills:
			t += " · Abschüsse %d" % e.kills
			if e.rank < 3:
				t += " (nächster Rang bei %d)" % int(g.ranks[e.rank])
		_sel_hpt.text = t
		_sel_extra.text = extra(e)


func _one(e: Ent) -> void:
	var g := game
	var f := g.players[e.owner].faction
	_sel_box.add_child(_label("Auswahl", 10, UiTheme.BRASS, true))
	var one := HBoxContainer.new()
	one.add_theme_constant_override("separation", px(8))
	var por := PanelContainer.new()
	por.add_theme_stylebox_override("panel", UiTheme.flat(Color("26321c"), UiTheme.EDGE, maxi(1, px(1)), px(3)))
	por.custom_minimum_size = Vector2(px(76), px(60))
	por.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	var img := TextureRect.new()
	var art := Data.building_art(f, e.key) if e.is_b else Data.unit_art(f, e.key)
	img.texture = Data.tex(art.get("icon", "")) if art.has("icon") else null
	img.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	img.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	img.mouse_filter = Control.MOUSE_FILTER_IGNORE
	por.add_child(img)
	one.add_child(por)
	var info := VBoxContainer.new()
	info.add_theme_constant_override("separation", px(2))
	info.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var nm := _label(String(e.b.get("name", e.key)) if e.is_b else String(e.u.get("name", e.key)), 14)
	nm.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	nm.clip_text = true
	info.add_child(nm)
	var sub: String
	if e.is_b:
		sub = "Gebäude" if e.owner == 0 else "feindliches Gebäude"
	else:
		sub = "%s · %s%s" % [e.u.get("role", ""), Data.armor_names.get(e.u.get("armor", ""), ""), " · Feind" if e.owner != 0 else ""]
	var sl := _label(sub, 11, UiTheme.DIM)
	sl.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	info.add_child(sl)
	if not e.is_b:
		info.add_child(_rank_row(e))
	_sel_hp = Control.new()
	_sel_hp.custom_minimum_size = Vector2(0, px(7))
	_sel_hp.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_sel_hp.set_meta("k", 1.0)
	_sel_hp.draw.connect(_draw_hp.bind(_sel_hp))
	info.add_child(_sel_hp)
	_sel_hpt = _label("", 12, UiTheme.DIM)
	info.add_child(_sel_hpt)
	_sel_extra = _label("", 12, Color("cfe8b8"))
	_sel_extra.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	info.add_child(_sel_extra)
	one.add_child(info)
	_sel_box.add_child(one)
	if e.owner != 0:
		return
	var row := HFlowContainer.new()
	row.add_theme_constant_override("h_separation", px(4))
	row.add_theme_constant_override("v_separation", px(4))
	if e.is_b:
		if e.key != "hq":
			_act(row, "Verkaufen (+%d)" % int(Rng.js_round(float(e.b["cost"]) * 0.5 * e.hp / e.max_hp)), "sell", func() -> void:
				g.sell(e)
				input.set_sel([]))
		_act(row, "Reparieren", "repair", func() -> void: e.repairing = not e.repairing, e.repairing)
		var q: Variant = e.b.get("produces")
		if q != null and q != "build":
			_act(row, "Hauptgebäude", "primary", func() -> void: g.me.primary[q] = e.id, g.me.primary.get(q, -1) == e.id)
		var hg := g.garrison_of(e)
		if hg and not hg.occ.is_empty():
			_act(row, "Räumen (D)", "exit", func() -> void: g.command_exit(hg.occ.duplicate()))
	elif e.u.get("transport", 0):
		_act(row, "Entladen (D)", "unload", func() -> void: g.command_unload(e))
	elif e.inside:
		_act(row, "Räumen (D)", "exit", func() -> void: g.command_exit([e]))
	if row.get_child_count():
		var gap := Control.new()
		gap.custom_minimum_size = Vector2(0, px(5))
		_sel_box.add_child(gap)
		_sel_box.add_child(row)


func _draw_hp(c: Control) -> void:
	var kk: float = c.get_meta("k")
	var s := c.size
	c.draw_rect(Rect2(Vector2.ZERO, s), Color("0b0d09"))
	c.draw_rect(Rect2(Vector2.ZERO, s), UiTheme.EDGE, false, 1.0)
	var col := Color("5fd65a") if kk > 0.6 else (Color("e8c03a") if kk > 0.3 else Color("e2492f"))
	var w := (s.x - 2) * kk
	c.draw_rect(Rect2(Vector2(1, 1), Vector2(w, s.y - 2)), col)
	var x := float(px(4))
	while x < w:
		c.draw_rect(Rect2(Vector2(1 + x, 1), Vector2(maxi(1, px(1)), s.y - 2)), Color(0, 0, 0, 0.35))
		x += px(5)


func _many(sel: Array[Ent]) -> void:
	var g := game
	_sel_box.add_child(_label("Auswahl · %d" % sel.size(), 10, UiTheme.BRASS, true))
	var counts := {}
	var order := []
	for e in sel:
		var kk := ("b:" if e.is_b else "u:") + e.key
		if not counts.has(kk):
			counts[kk] = []
			order.append(kk)
		counts[kk].append(e)
	var wrap := GridContainer.new()
	wrap.columns = 4
	wrap.add_theme_constant_override("h_separation", px(4))
	wrap.add_theme_constant_override("v_separation", px(4))
	for kk in order:
		var list: Array = counts[kk]
		var b := _button()
		b.custom_minimum_size = Vector2(0, px(44))
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var first: Ent = list[0]
		b.tooltip_text = String(first.b.get("name", "")) if first.is_b else String(first.u.get("name", ""))
		b.name = "Group_" + first.key
		var img := TextureRect.new()
		img.texture = _icon(kk)
		img.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		img.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		img.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		img.offset_left = px(3)
		img.offset_top = px(3)
		img.offset_right = -px(3)
		img.offset_bottom = -px(5)
		img.mouse_filter = Control.MOUSE_FILTER_IGNORE
		b.add_child(img)
		var n := _label(str(list.size()), 12, Color.WHITE)
		n.anchor_left = 1.0
		n.anchor_top = 1.0
		n.anchor_right = 1.0
		n.anchor_bottom = 1.0
		n.grow_horizontal = Control.GROW_DIRECTION_BEGIN
		n.grow_vertical = Control.GROW_DIRECTION_BEGIN
		n.offset_right = -px(4)
		n.offset_bottom = -px(1)
		n.add_theme_color_override("font_outline_color", Color.BLACK)
		n.add_theme_constant_override("outline_size", px(3))
		b.add_child(n)
		b.pressed.connect(func() -> void:
			if Input.is_key_pressed(KEY_SHIFT):
				input.set_sel(sel.filter(func(s: Ent) -> bool: return not list.has(s)))
			else:
				input.set_sel(list))
		wrap.add_child(b)
	_sel_box.add_child(wrap)
	var inside: Array = sel.filter(func(e: Ent) -> bool: return e.inside != null and e.owner == 0)
	if not inside.is_empty():
		var row := HFlowContainer.new()
		_act(row, "Räumen (D) · %d" % inside.size(), "exit", func() -> void: g.command_exit(inside))
		_sel_box.add_child(row)


## the extra line of the selection (hud.ts extra())
func extra(e: Ent) -> String:
	var g := game
	var u := e.u
	if e.is_b:
		if e.key == "airfield":
			var n := 0
			for j in g.ents:
				if j.jet and not j.dead and j.home == e.id:
					n += 1
			return "Stellplätze belegt: %d / %d" % [n, int(e.b.get("slots", 3))]
		if e.repairing:
			return "Wird repariert"
		var hg := g.garrison_of(e)
		if hg:
			return "Besatzung %d / %d · Reichweite %.1f" % [hg.occ.size(), hg.cap, g.range_of(e)]
		var bw: Variant = e.b.get("weapon")
		return "Reichweite %s" % _num(bw["range"]) if bw is Dictionary else ""
	if u.is_empty():
		return ""
	if e.inside:
		var h: Game.Garrison = e.inside
		return "Im Gebäude: %s (%d/%d) · Deckung %d%% · Reichweite %.1f" % [h.name, h.occ.size(), h.cap, int(Rng.js_round((1.0 - g.cover) * 100)), g.range_of(e)]
	if u.get("engineer", false):
		return ("Tippen" if touch else "Rechtsklick") + " auf feindliches Gebäude: erobern"
	if u.get("harvester", false):
		return "Ladung: %d / %d" % [floori(e.cargo), int(g.harvest_load)]
	if u.get("transport", 0):
		return "An Bord: %d / %d" % [e.passengers.size(), int(u["transport"])]
	if u.get("carrier", 0):
		return "Jets an Bord: %d / %d" % [e.planes, int(u["carrier"])]
	if e.jet:
		if e.js == "park":
			return "Am Boden, einsatzbereit" if e.ammo >= 1 else "Aufmunitionieren %d%%" % floori(e.rearm / 6.0 * 100)
		return "Im Einsatz" if e.js == "out" else "Rückflug"
	if u.get("stealth", false):
		return "Getarnt" if e.hidden else "Sichtbar (stillhalten zum Tarnen)"
	var w: Variant = u.get("weapon")
	return "Reichweite %s · %s" % [_num(w["range"]), _targets(w)] if w is Dictionary else ""


## a control of the interface by name (tests): "MenuButton", "Tab_inf", "Item_power", "Act_sell" …
func control(id: String) -> Control:
	return find_child(id, true, false) as Control
