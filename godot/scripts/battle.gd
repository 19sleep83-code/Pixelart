extends Node
## One battle: the game, the computer opponent and the world, run at a fixed step like the prototype
## (src/main.ts: real time is gathered and spent in steps of 1/30 s, at most six per frame).
## The input here is only for testing (scripts/view/debug_input.gd); the real interface comes later.

signal finished

const STEP := 1.0 / 30.0

var opts: Dictionary = {}
var game: Game
var ai: AI
var world: World
var paused := false
var _acc := 0.0
var _over_t := -1.0


func _ready() -> void:
	game = Game.new(opts)
	ai = AI.new(game)
	world = World.new()
	add_child(world)
	world.setup(game)
	game.on_sound = func(ev: String, x: float, y: float) -> void:
		Sound.play(ev, world.tile_to_px(x, y))
	var hq: Ent = null
	for e in game.ents:
		if e.owner == 0 and e.key == "hq":
			hq = e
			break
	if hq:
		world.look_at_tile(hq.x + 2, hq.y - 2)
	game.msg("Gefechtsstand bereit. Baue ein Kraftwerk und ein Rohstoffdepot.", "info")
	if game.map.type != "land":
		game.msg("Gewässer in Reichweite: Eine Werft am Ufer baut Schiffe.", "info")
	var inp := DebugInput.new()
	inp.world = world
	inp.game = game
	inp.battle = self
	add_child(inp)


func _exit_tree() -> void:
	if game:
		game.dispose()


func _process(delta: float) -> void:
	var dt := minf(0.1, delta)
	world.paused = paused
	if not paused:
		_acc += dt
		var n := 0
		while _acc >= STEP and n < 6:
			game.update(STEP)
			ai.update(STEP)
			_acc -= STEP
			n += 1
		if n >= 6:
			_acc = 0.0
	Sound.listener = world.camera.position
	if game.over != 0:
		if _over_t < 0:
			_over_t = 0.0
		_over_t += dt
		if _over_t > 5.0:
			set_process(false)
			finished.emit()


func quit() -> void:
	finished.emit()
