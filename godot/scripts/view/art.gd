class_name Art
extends RefCounted
## Every sprite the battle draws, as sheets from the manifest (port of the parts of `Assets` in
## src/game/assets.ts the renderer uses), plus the few pictures the renderer makes itself: the
## ellipse rings, the soft glow for lights, the tileable cloud shadow. Loaded once, shared.

## a unit's sheets (see manifest.units)
class UnitArt:
	var hull: Sheet
	var shadow: Sheet
	var hull2: Sheet
	var turret: Sheet
	## harvester: loaded
	var alt: Sheet
	## infantry: the two steps of a walk, taking aim
	var walk1: Sheet
	var walk2: Sheet
	var aim: Sheet
	var hull_anim: Array[Sheet] = []
	var turret_anim: Array[Sheet] = []
	var wreck: Sheet
	var wreck_turret: Sheet
	var mount := [0.0, 0.0, 0.0]
	## turret pivot relative to the hull pivot, per hull direction (of 32)
	var mount_offsets := PackedVector2Array()
	var rotor: Dictionary = {}
	var burner: Dictionary = {}


class BuildingArt:
	var body: Sheet
	var shadow: Sheet
	var turret: Sheet
	var mount_offset := Vector2.ZERO


static var _units := {}
static var _buildings := {}
## kind -> Array of [sprite: Sheet, shadow: Sheet]
static var statics := {}
static var ore: Array[Sheet] = []
static var explosion: Array[Sheet] = []
static var smoke: Sheet
static var soot: Sheet
static var dust: Sheet
static var fire: Sheet
static var scorch: Sheet
static var rubble: Sheet
static var _rings := {}
static var _glow: Texture2D
static var _tops := {}
static var _loaded := false

## team colours (src/game/colors.ts SCHEMES)
const TEAM := {
	"nato": [Color8(0x3d, 0x74, 0xd8), Color8(0x23, 0x4a, 0x9a), Color8(0x8f, 0xb4, 0xff)],
	"ru": [Color8(0xd2, 0x3a, 0x2c), Color8(0x8e, 0x21, 0x19), Color8(0xff, 0x9a, 0x86)],
}


static func load_all() -> void:
	if _loaded:
		return
	_loaded = true
	var m: Dictionary = Data.manifest
	for kind in m.get("landscape", {}):
		var arr := []
		for v in m["landscape"][kind]:
			arr.append([Sheet.of(v["sprite"]), Sheet.of(v["shadow"])])
		statics[kind] = arr
	for d in m.get("ore", []):
		ore.append(Sheet.of(d))
	var f: Dictionary = m.get("fx", {})
	for d in f.get("explosion", []):
		explosion.append(Sheet.of(d))
	smoke = Sheet.of(f.get("smoke"))
	soot = Sheet.of(f.get("soot"))
	dust = Sheet.of(f.get("dust"))
	fire = Sheet.of(f.get("fire"))
	scorch = Sheet.of(f.get("scorch"))
	rubble = Sheet.of(f.get("rubble"))


static func unit(faction: String, key: String) -> UnitArt:
	var k := faction + "/" + key
	if _units.has(k):
		return _units[k]
	var d := Data.unit_art(faction, key)
	var a := UnitArt.new()
	var s: Dictionary = d.get("sheets", {})
	a.hull = Sheet.of(s.get("hull"))
	a.shadow = Sheet.of(s.get("shadow"))
	a.hull2 = Sheet.of(s.get("hull2"))
	a.turret = Sheet.of(s.get("turret"))
	a.alt = Sheet.of(s.get("alt"))
	a.walk1 = Sheet.of(s.get("walk1"))
	a.walk2 = Sheet.of(s.get("walk2"))
	a.aim = Sheet.of(s.get("aim"))
	for h in s.get("hullAnim", []):
		a.hull_anim.append(Sheet.of(h))
	for t in s.get("turretAnim", []):
		a.turret_anim.append(Sheet.of(t))
	a.wreck = Sheet.of(s.get("wreck"))
	a.wreck_turret = Sheet.of(s.get("wreckTurret"))
	a.mount = d.get("mount", [0, 0, 0])
	for o in d.get("mountOffsets", []):
		a.mount_offsets.append(Vector2(float(o[0]), float(o[1])))
	var r: Variant = d.get("rotor")
	if r is Dictionary:
		a.rotor = r
	var b: Variant = d.get("burner")
	if b is Dictionary:
		a.burner = b
	_units[k] = a
	return a


static func building(faction: String, key: String) -> BuildingArt:
	var k := faction + "/" + key
	if _buildings.has(k):
		return _buildings[k]
	var d := Data.building_art(faction, key)
	var a := BuildingArt.new()
	var s: Dictionary = d.get("sheets", {})
	a.body = Sheet.of(s.get("body"))
	a.shadow = Sheet.of(s.get("shadow"))
	a.turret = Sheet.of(s.get("turret"))
	var mo: Variant = d.get("mountOffset")
	if mo is Array:
		a.mount_offset = Vector2(float(mo[0]), float(mo[1]))
	_buildings[k] = a
	return a


## where a turret pivot lands on screen relative to the hull pivot at a heading (assets.ts mountOffset)
static func mount_offset(a: float, b: float, c: float, yaw: float) -> Vector2:
	var rx := -a * sin(yaw) + b * cos(yaw)
	var ry := a * cos(yaw) + b * sin(yaw)
	return Vector2((rx - ry) * 2.0, (rx + ry) * 0.5 * 2.0 - c * 2.5)


## a thin ellipse ring of radius rx (white, tinted when drawn), as the prototype's ring()
static func ring(rx: int) -> Texture2D:
	if _rings.has(rx):
		return _rings[rx]
	var W := rx * 2 + 3
	var H := rx + 3
	var img := Image.create(W, H, false, Image.FORMAT_RGBA8)
	var rrs := [rx, rx - 1] if rx > 3 else [rx]
	for rr in rrs:
		for a in 360:
			var t := a / 180.0 * PI
			var x := int(Rng.js_round(W / 2.0 - 0.5 + cos(t) * rr))
			var y := int(Rng.js_round(H / 2.0 - 0.5 + sin(t) * rr * 0.5))
			if x >= 0 and y >= 0 and x < W and y < H:
				img.set_pixel(x, y, Color.WHITE)
	var tex := ImageTexture.create_from_image(img)
	_rings[rx] = tex
	return tex


## a soft round light: white, alpha falling off to the rim like the prototype's radial gradient
## (colour and alpha both fade, so the light falls off with the square of the distance)
static func glow() -> Texture2D:
	if _glow:
		return _glow
	var S := 64
	var img := Image.create(S, S, false, Image.FORMAT_RGBA8)
	for y in S:
		for x in S:
			var d := Vector2(x + 0.5 - S / 2.0, y + 0.5 - S / 2.0).length() / (S / 2.0)
			var k := clampf(1.0 - d, 0.0, 1.0)
			img.set_pixel(x, y, Color(1, 1, 1, k * k))
	_glow = ImageTexture.create_from_image(img)
	return _glow


## the highest solid pixel of a sheet's first frame: how far above its pivot, and how far to the side
static func top_of(s: Sheet) -> Vector2:
	if _tops.has(s):
		return _tops[s]
	var t := Vector2(s.ay, 0)
	var img := s.tex.get_image()
	if img:
		if img.is_compressed():
			img.decompress()
		var r := s.src(0)
		var done := false
		for y in s.ch:
			for x in s.cw:
				if img.get_pixel(int(r.position.x) + x, int(r.position.y) + y).a8 > 100:
					t = Vector2(s.ay - y, x - s.ax)
					done = true
					break
			if done:
				break
	_tops[s] = t
	return t
