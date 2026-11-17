class_name Settings
## The few settings that are kept between runs (user://settings.cfg, like the prototype's
## localStorage): the menu's last choices, the zoom and the sound.

const PATH := "user://settings.cfg"

static var _cfg: ConfigFile


static func _file() -> ConfigFile:
	if _cfg == null:
		_cfg = ConfigFile.new()
		_cfg.load(PATH)
	return _cfg


static func get_value(section: String, key: String, fallback: Variant = null) -> Variant:
	return _file().get_value(section, key, fallback)


static func set_value(section: String, key: String, value: Variant) -> void:
	var c := _file()
	c.set_value(section, key, value)
	c.save(PATH)
