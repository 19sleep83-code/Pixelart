extends Node
## Runs one test with the autoloads in place:
##   godot --path godot res://tests/runner.tscn -- <test> [args …]
## A test is a script in tests/ with `func run(args: PackedStringArray) -> void` (it may await) that
## calls `done()` on its parent runner when finished, or returns.


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.is_empty():
		push_error("Kein Test angegeben")
		get_tree().quit(1)
		return
	var script: Script = load("res://tests/%s.gd" % args[0])
	var t: Node = script.new()
	add_child(t)
	await t.run(args.slice(1))
	get_tree().quit()
