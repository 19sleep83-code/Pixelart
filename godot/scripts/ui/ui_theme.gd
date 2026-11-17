class_name UiTheme
## The look of the interface: olive buttons with brass rivets and dark panels, from the exported pixel
## art (nine-slice), scaled up for the screen (×2 on a PC, ×3 on a phone).

const INK := Color("0b0d07")
const LIGHT := Color("e8e3cb")
const BRASS := Color("f0c840")
const GREEN := Color("8fe060")
const RED := Color("ff5a4a")


static func scale_for(size: Vector2) -> int:
	return 3 if min(size.x, size.y) >= 1000 and OS.has_feature("mobile") else 2


static func _box(path: String, margin: int, k: int, pad := 6) -> StyleBoxTexture:
	var sb := StyleBoxTexture.new()
	sb.texture = Data.tex("ui/%s@%dx.png" % [path, k])
	sb.set_texture_margin_all(margin * k)
	sb.set_content_margin_all(pad * k)
	return sb


static func make(k := 2) -> Theme:
	var th := Theme.new()
	th.set_stylebox("normal", "Button", _box("button_normal", 6, k, 4))
	th.set_stylebox("hover", "Button", _box("button_hover", 6, k, 4))
	th.set_stylebox("pressed", "Button", _box("button_pressed", 6, k, 4))
	th.set_stylebox("disabled", "Button", _box("button_disabled", 6, k, 4))
	th.set_stylebox("focus", "Button", StyleBoxEmpty.new())
	th.set_color("font_color", "Button", LIGHT)
	th.set_color("font_hover_color", "Button", Color.WHITE)
	th.set_color("font_pressed_color", "Button", BRASS)
	th.set_color("font_disabled_color", "Button", Color("6a6d60"))
	th.set_stylebox("panel", "PanelContainer", _box("panel", 8, k, 8))
	th.set_stylebox("panel", "Panel", _box("panel", 8, k, 8))
	th.set_color("font_color", "Label", LIGHT)
	th.set_font_size("font_size", "Label", 7 * k)
	th.set_font_size("font_size", "Button", 7 * k)
	th.set_font_size("font_size", "LineEdit", 7 * k)
	var le := StyleBoxFlat.new()
	le.bg_color = Color("12150f")
	le.border_color = Color("46532b")
	le.set_border_width_all(k)
	le.set_content_margin_all(3 * k)
	th.set_stylebox("normal", "LineEdit", le)
	th.set_color("font_color", "LineEdit", LIGHT)
	return th


static func icon(key: String, k := 2) -> Texture2D:
	return Data.tex("ui/icons/%s@%dx.png" % [key, k])
