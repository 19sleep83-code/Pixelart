extends Node
## The start: the menu, then the battle (world, interface, computer opponent), then back.

var menu: Menu
var battle: Node
var _menu_layer: CanvasLayer


func _ready() -> void:
	UiTheme.install_cursors(UiTheme.scale_for(get_viewport().get_visible_rect().size))
	Sound.enabled = bool(Settings.get_value("audio", "sound", true))
	show_menu()


func _end_battle() -> void:
	if battle:
		battle.queue_free()
		battle = null
	Input.set_default_cursor_shape(Input.CURSOR_ARROW)


func show_menu() -> void:
	_end_battle()
	_menu_layer = CanvasLayer.new()
	add_child(_menu_layer)
	menu = Menu.new()
	_menu_layer.add_child(menu)
	menu.start.connect(func(opts: Dictionary):
		_menu_layer.queue_free()
		_menu_layer = null
		menu = null
		start_battle(opts))


func start_battle(opts: Dictionary) -> void:
	_end_battle()
	var scene: Script = load("res://scripts/battle.gd")
	battle = scene.new()
	battle.set("opts", opts)
	add_child(battle)
	if battle.has_signal("finished"):
		battle.connect("finished", show_menu)
	if battle.has_signal("restart"):
		battle.connect("restart", start_battle)
