class_name Sheet
extends RefCounted
## One sprite sheet from the manifest: a grid of equal cells, each with its pivot (the point on the
## ground under the object) at (ax, ay). Drawn straight into a canvas item through the
## RenderingServer, so a whole layer can be filled in one pass.

var tex: Texture2D
var rid: RID
var cw := 0
var ch := 0
var cols := 1
var n := 1
var ax := 0
var ay := 0


static func of(d: Variant) -> Sheet:
	if not d is Dictionary:
		return null
	var s := Sheet.new()
	s.tex = Data.tex(String(d["file"]))
	if s.tex == null:
		return null
	s.rid = s.tex.get_rid()
	s.cw = int(d["cellW"])
	s.ch = int(d["cellH"])
	s.cols = maxi(1, int(d.get("cols", 1)))
	s.n = maxi(1, int(d.get("frames", 1)))
	s.ax = int(d["anchorX"])
	s.ay = int(d["anchorY"])
	return s


## the frame that shows a heading (sets of n directions; JS rounding)
func dir(yaw: float) -> int:
	return posmod(int(floorf(yaw / TAU * n + 0.5)), n)


func src(i: int) -> Rect2:
	return Rect2((i % cols) * cw, (i / cols) * ch, cw, ch)


## frame i with its pivot at (x, y)
func draw(ci: RID, i: int, x: float, y: float, mod := Color.WHITE) -> void:
	RenderingServer.canvas_item_add_texture_rect_region(ci, Rect2(x - ax, y - ay, cw, ch), rid, Rect2((i % cols) * cw, (i / cols) * ch, cw, ch), mod)


## frame i scaled about its pivot
func draw_scaled(ci: RID, i: int, x: float, y: float, k: float, mod := Color.WHITE) -> void:
	RenderingServer.canvas_item_add_texture_rect_region(ci, Rect2(roundf(x - ax * k), roundf(y - ay * k), roundf(cw * k), roundf(ch * k)), rid, src(i), mod)


## only the rows from `top` to `bottom` (cell pixels) of frame i
func draw_rows(ci: RID, i: int, x: float, y: float, top: int, bottom: int, mod := Color.WHITE) -> void:
	top = clampi(top, 0, ch)
	bottom = clampi(bottom, 0, ch)
	if bottom <= top:
		return
	var r := src(i)
	RenderingServer.canvas_item_add_texture_rect_region(ci, Rect2(x - ax, y - ay + top, cw, bottom - top), rid, Rect2(r.position.x, r.position.y + top, cw, bottom - top), mod)
