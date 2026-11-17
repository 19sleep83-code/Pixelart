extends Node
## One battle: the game, the computer opponent, the world, the controls and the interface, run at a
## fixed step like the prototype (src/main.ts: real time is gathered and spent in steps of 1/30 s, at
## most six per frame). P / F10 / the menu button pause; the end screen comes 1.5 s after the end.

## back to the main menu
signal finished
## a new battle with these options (pause menu "Neues Gefecht", end screen "Nochmal")
signal restart(opts: Dictionary)

const STEP := 1.0 / 30.0

var opts: Dictionary = {}
var game: Game
var ai: AI
var world: World
var input: PlayerInput
var hud: Hud
var screens: BattleScreens
var paused := false
var ended := false
## UI scale (2 on a PC, 3 on a phone)
var ui_scale := 2
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
	ui_scale = UiTheme.scale_for(get_viewport().get_visible_rect().size)
	var touch := UiTheme.is_touch()
	UiTheme.install_cursors(ui_scale)
	Sound.enabled = bool(Settings.get_value("audio", "sound", true))
	input = PlayerInput.new()
	input.game = game
	input.world = world
	input.ui_scale = ui_scale
	add_child(input)
	var layer := CanvasLayer.new()
	layer.layer = 1
	add_child(layer)
	hud = Hud.new()
	layer.add_child(hud)
	input.hud = hud
	hud.setup(game, world, input, ui_scale, touch)
	var top := CanvasLayer.new()
	top.layer = 2
	add_child(top)
	screens = BattleScreens.new()
	top.add_child(screens)
	screens.setup(ui_scale)
	# the zoom: the screen's start level plus the player's last choice
	var off := int(Settings.get_value("view", "zoom", 0))
	world.set_zoom_level(clampi(input.base_zoom() + off, 0, World.LEVELS.size() - 1))
	var hq: Ent = null
	for e in game.ents:
		if e.owner == 0 and e.key == "hq":
			hq = e
			break
	if hq:
		input.look_at(hq.x + 2, hq.y - 2)
	game.msg("Gefechtsstand bereit. Baue ein Kraftwerk und ein Rohstoffdepot.", "info")
	if game.map.type != "land":
		game.msg("Gewässer in Reichweite: Eine Werft am Ufer baut Schiffe.", "info")
	input.pause_requested.connect(func() -> void: set_paused(not paused))
	hud.menu_pressed.connect(func() -> void: set_paused(true))
	screens.resume.connect(func() -> void: set_paused(false))
	screens.quit.connect(quit)
	screens.restart.connect(func() -> void:
		var o := opts.duplicate()
		o["seed"] = randi_range(1, 99999)
		restart.emit(o))


func _exit_tree() -> void:
	if game:
		game.dispose()


func set_paused(on: bool) -> void:
	if ended:
		return
	paused = on
	input.paused = on
	if on:
		screens.show_pause()
	else:
		screens.hide_all()


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
	if game.over != 0 and not ended:
		if _over_t < 0:
			_over_t = 0.0
		_over_t += dt
		if _over_t > 1.5:
			show_end()


func show_end() -> void:
	ended = true
	paused = true
	input.paused = true
	screens.show_end(game)


func quit() -> void:
	set_process(false)
	finished.emit()
