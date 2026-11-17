extends Node
## Everything the game knows before it starts: unit and building values, the damage table, the rules,
## and the sprite sheets described in the manifest (exported from the browser prototype).

const ROOT := "res://assets/sprites/"
const PREFIX := "pixelfront_sprites/"

## the build menus' order, as in the prototype (planned units are not playable yet)
const UNIT_ORDER := ["rifle", "at", "sniper", "engineer", "harv", "scout", "ifv", "mbt", "aa", "art", "mlrs", "heli", "jet", "boat", "corvette", "destroyer", "lander", "carrier"]
const BUILD_ORDER := ["power", "ref", "barracks", "factory", "radar", "shipyard", "helipad", "airfield", "bunker", "rocket"]
const QUEUES := ["build", "inf", "veh", "air", "sea"]

## screen size of a tile and of one unit of height, in fine pixels
const TW := 64
const TH := 32
const KZ := 2.5
const SCALE := 2

var manifest: Dictionary
var units_json: Dictionary
var buildings_json: Dictionary
var damage: Dictionary
var rules: Dictionary
var armor_names: Dictionary
var _tex := {}


func _ready() -> void:
	manifest = _json(ROOT + "manifest.json")
	units_json = _json(ROOT + "data/units.json")
	buildings_json = _json(ROOT + "data/buildings.json")
	var d: Dictionary = _json(ROOT + "data/damage.json")
	damage = d.get("table", {})
	armor_names = d.get("armorNames", {})
	rules = _json(ROOT + "data/rules.json")


func _json(path: String) -> Variant:
	var text := FileAccess.get_file_as_string(path)
	if text.is_empty():
		push_error("Daten fehlen: " + path)
		return {}
	var v: Variant = JSON.parse_string(text)
	return v if v != null else {}


## a texture by the path the manifest gives (with or without the exporter's folder name)
func tex(file: String) -> Texture2D:
	if _tex.has(file):
		return _tex[file]
	var rel := file.trim_prefix(PREFIX)
	var t: Texture2D = load(ROOT + rel)
	if t == null:
		push_error("Bild fehlt: " + rel)
	_tex[file] = t
	return t


## the values of every unit for one side, with that side's names; planned units included but marked
func unit_defs(faction: String) -> Dictionary:
	var out := {}
	var units: Dictionary = units_json.get("units", {})
	var names: Dictionary = units_json.get("names", {}).get(faction, {})
	var hulls: Dictionary = units_json.get("hullPerFaction", {}).get(faction, {})
	for key in units:
		var d: Dictionary = units[key].duplicate(true)
		d["key"] = key
		d["name"] = names.get(key, {}).get("name", key)
		d["role"] = names.get(key, {}).get("role", "")
		if hulls.has(key):
			d["hull"] = hulls[key]
		out[key] = d
	return out


func building_defs() -> Dictionary:
	return buildings_json.get("buildings", {}).duplicate(true)


## how much of a weapon's damage reaches an armour class
func vs(cls: String, armor: String) -> float:
	return float(damage.get(cls, {}).get(armor, 0.0))


func unit_art(faction: String, key: String) -> Dictionary:
	return manifest.get("units", {}).get(faction, {}).get(key, {})


func building_art(faction: String, key: String) -> Dictionary:
	return manifest.get("buildings", {}).get(faction, {}).get(key, {})


func rule(key: String, fallback: Variant = null) -> Variant:
	return rules.get(key, fallback)
