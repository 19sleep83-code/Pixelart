extends Node
## The start: the menu, then the battle (world, interface, computer opponent), then back.

var menu: Menu
var battle: Node


func _ready() -> void:
	show_menu()


func show_menu() -> void:
	if battle:
		battle.queue_free()
		battle = null
	var layer := CanvasLayer.new()
	add_child(layer)
	menu = Menu.new()
	layer.add_child(menu)
	menu.start.connect(func(opts: Dictionary):
		layer.queue_free()
		start_battle(opts))


func start_battle(opts: Dictionary) -> void:
	var scene: Script = load("res://scripts/battle.gd")
	battle = scene.new()
	battle.set("opts", opts)
	add_child(battle)
	if battle.has_signal("finished"):
		battle.connect("finished", show_menu)
