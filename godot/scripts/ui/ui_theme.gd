class_name UiTheme
## The look of the interface: olive buttons with brass rivets and dark panels, from the exported pixel
## art (nine-slice), scaled up for the screen (×2 on a PC, ×3 on a phone). Colours from the
## prototype's style.css.

const INK := Color("0b0d07")
const LIGHT := Color("e8e3cb")
const DIM := Color("a3a389")
const BRASS := Color("d8bf5c")
const AMBER := Color("ffb43a")
const GREEN := Color("8dff74")
const RED := Color("ff5a4a")
const BLUE := Color("3d74d8")
const PLATE := Color("283020")
const PLATE2 := Color("313a27")
const PLATE3 := Color("1c2217")
const EDGE := Color("4d5a3a")
const EDGE2 := Color("66744d")

## tests: force the scale (0 = by the screen) and the touch controls (-1 = by the device)
static var force_scale := 0
static var force_touch := -1

## the cursors of the exported art and the shapes they are put on
const CURSORS := {
	"pointer": Input.CURSOR_ARROW,
	"select": Input.CURSOR_POINTING_HAND,
	"move": Input.CURSOR_MOVE,
	"attack": Input.CURSOR_CROSS,
	"enter": Input.CURSOR_DRAG,
	"capture": Input.CURSOR_CAN_DROP,
	"forbidden": Input.CURSOR_FORBIDDEN,
	"place": Input.CURSOR_HELP,
}

static var _stencil: Font
static var _cursor_k := 0


static func scale_for(size: Vector2) -> int:
	if force_scale > 0:
		return force_scale
	return 3 if min(size.x, size.y) >= 1000 and OS.has_feature("mobile") else 2


## touch controls (box-select and deselect buttons, taps as commands)
static func is_touch() -> bool:
	if force_touch >= 0:
		return force_touch == 1
	return OS.has_feature("mobile") or DisplayServer.is_touchscreen_available()


## CSS pixels of the prototype (at its ×2 look) → screen pixels at scale k
static func px(css: float, k: int) -> int:
	return int(roundf(css * k / 2.0))


static func _box(path: String, margin: int, k: int, pad := 6) -> StyleBoxTexture:
	var sb := StyleBoxTexture.new()
	sb.texture = Data.tex("ui/%s@%dx.png" % [path, k])
	sb.set_texture_margin_all(margin * k)
	sb.set_content_margin_all(pad * k)
	return sb


## a flat box: fill, border (all sides or [l, t, r, b]), padding
static func flat(bg: Color, border: Color = Color.TRANSPARENT, bw: Variant = 0, pad: Variant = 0) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = bg
	sb.border_color = border
	if bw is Array:
		sb.border_width_left = bw[0]
		sb.border_width_top = bw[1]
		sb.border_width_right = bw[2]
		sb.border_width_bottom = bw[3]
	else:
		sb.set_border_width_all(int(bw))
	if pad is Array:
		sb.content_margin_left = pad[0]
		sb.content_margin_top = pad[1]
		sb.content_margin_right = pad[2]
		sb.content_margin_bottom = pad[3]
	else:
		sb.set_content_margin_all(float(pad))
	return sb


## the stencil lettering of plates and titles (bold, spaced)
static func stencil() -> Font:
	if _stencil == null:
		var f := FontVariation.new()
		f.base_font = ThemeDB.fallback_font
		f.variation_embolden = 0.9
		f.spacing_glyph = 1
		_stencil = f
	return _stencil


static func make(k := 2) -> Theme:
	var th := Theme.new()
	th.set_stylebox("normal", "Button", _box("button_normal", 6, k, 4))
	th.set_stylebox("hover", "Button", _box("button_hover", 6, k, 4))
	th.set_stylebox("pressed", "Button", _box("button_pressed", 6, k, 4))
	th.set_stylebox("hover_pressed", "Button", _box("button_pressed", 6, k, 4))
	th.set_stylebox("disabled", "Button", _box("button_disabled", 6, k, 4))
	th.set_stylebox("focus", "Button", StyleBoxEmpty.new())
	th.set_color("font_color", "Button", LIGHT)
	th.set_color("font_hover_color", "Button", Color.WHITE)
	th.set_color("font_pressed_color", "Button", BRASS)
	th.set_color("font_hover_pressed_color", "Button", BRASS)
	th.set_color("font_focus_color", "Button", LIGHT)
	th.set_color("font_disabled_color", "Button", Color("6a6d60"))
	th.set_constant("h_separation", "Button", 2 * k)
	th.set_stylebox("panel", "PanelContainer", _box("panel", 8, k, 8))
	th.set_stylebox("panel", "Panel", _box("panel", 8, k, 8))
	th.set_color("font_color", "Label", LIGHT)
	th.set_font_size("font_size", "Label", 7 * k)
	th.set_font_size("font_size", "Button", 7 * k)
	th.set_font_size("font_size", "LineEdit", 7 * k)
	th.set_font_size("font_size", "CheckBox", 7 * k)
	for st in ["normal", "hover", "pressed", "hover_pressed", "focus"]:
		th.set_stylebox(st, "CheckBox", StyleBoxEmpty.new())
	th.set_color("font_color", "CheckBox", LIGHT)
	th.set_color("font_hover_color", "CheckBox", Color.WHITE)
	th.set_color("font_pressed_color", "CheckBox", LIGHT)
	th.set_color("font_hover_pressed_color", "CheckBox", Color.WHITE)
	var le := StyleBoxFlat.new()
	le.bg_color = Color("12150f")
	le.border_color = Color("46532b")
	le.set_border_width_all(k)
	le.set_content_margin_all(3 * k)
	th.set_stylebox("normal", "LineEdit", le)
	th.set_color("font_color", "LineEdit", LIGHT)
	th.set_stylebox("panel", "TooltipPanel", flat(Color("1d2316"), EDGE2, k, 3 * k))
	th.set_color("font_color", "TooltipLabel", LIGHT)
	th.set_font_size("font_size", "TooltipLabel", 6 * k)
	return th


static func icon(key: String, k := 2) -> Texture2D:
	return Data.tex("ui/icons/%s@%dx.png" % [key, k])


## the pixel cursors of the export (×2 on a PC, ×3 on a phone), hotspots from the manifest
static func install_cursors(k := 2) -> void:
	if _cursor_k == k:
		return
	_cursor_k = k
	var info: Dictionary = Data.manifest.get("ui", {}).get("cursors", {})
	for name: String in CURSORS:
		var c: Dictionary = info.get(name, {})
		var file := String(c.get("file", "ui/cursors/" + name))
		var tex := Data.tex("%s@%dx.png" % [file.trim_prefix(Data.PREFIX), k])
		if tex == null:
			continue
		var hs: Array = c.get("hotspot", [0, 0])
		Input.set_custom_mouse_cursor(tex, CURSORS[name], Vector2(float(hs[0]), float(hs[1])) * k)
