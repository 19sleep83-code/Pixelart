extends Node
## Plays the game's sound events (see docs/SOUND.md). Every event has one or more files, a volume, a
## spread of pitch and a cap on how many may play at once. Positional events fade with distance
## from the camera.

const DIR := "res://assets/sounds/"
const POOL := 24

var events: Dictionary = {}
var _streams := {}
var _players: Array[AudioStreamPlayer2D] = []
var _flat: Array[AudioStreamPlayer] = []
var _busy := {}
var enabled := true
var listener := Vector2.ZERO


func _ready() -> void:
	var text := FileAccess.get_file_as_string(DIR + "sounds.json")
	var d: Variant = JSON.parse_string(text) if not text.is_empty() else null
	if d is Dictionary:
		events = d.get("events", {})
	for i in POOL:
		var p := AudioStreamPlayer2D.new()
		p.max_distance = 2200.0
		p.attenuation = 1.6
		add_child(p)
		_players.append(p)
	for i in 6:
		var q := AudioStreamPlayer.new()
		add_child(q)
		_flat.append(q)


func _stream(file: String) -> AudioStream:
	if not _streams.has(file):
		_streams[file] = load(DIR + file)
	return _streams[file]


## play an event; `pos` in world pixels for positional sounds
func play(event: String, pos: Vector2 = Vector2.INF) -> void:
	if not enabled or not events.has(event):
		return
	var e: Dictionary = events[event]
	var files: Array = e.get("files", [])
	if files.is_empty():
		return
	var playing := 0
	for p in _players:
		if p.playing and p.get_meta("event", "") == event:
			playing += 1
	if playing >= int(e.get("maxVoices", 4)):
		return
	var stream := _stream(files[randi() % files.size()])
	var pitch := 1.0 + randf_range(-1.0, 1.0) * float(e.get("pitchSpread", 0.0))
	var vol := float(e.get("volumeDb", 0.0))
	if bool(e.get("positional", true)) and pos != Vector2.INF:
		for p in _players:
			if not p.playing:
				p.stream = stream
				p.pitch_scale = pitch
				p.volume_db = vol
				p.global_position = pos
				p.set_meta("event", event)
				p.play()
				return
	else:
		for q in _flat:
			if not q.playing:
				q.stream = stream
				q.pitch_scale = pitch
				q.volume_db = vol
				q.play()
				return
