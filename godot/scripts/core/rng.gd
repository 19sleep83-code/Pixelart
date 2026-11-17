class_name Rng
## Seeded random numbers and value noise. Everything random about a map comes from here,
## so the same seed always gives the same landscape.
##
## Port of src/core/rng.ts. JS integer semantics are reproduced bit-exactly: GDScript ints are
## 64-bit, so 32-bit values are kept unsigned in [0, 2^32) and masked after every step.
## `Math.imul` is emulated with 16-bit halves so no product overflows 64 bits.

const MASK32 := 0xFFFFFFFF
const TWO32 := 4294967296.0


## low 32 bits of a * b, as unsigned (JS `Math.imul(a, b) >>> 0`)
static func imul_u(a: int, b: int) -> int:
	var bu := b & MASK32
	var lo := (a & 0xFFFF) * bu
	var hi := (((a >> 16) & 0xFFFF) * bu) & 0xFFFF
	return (lo + (hi << 16)) & MASK32


## JS `Math.imul(a, b)` (signed 32-bit result)
static func imul(a: int, b: int) -> int:
	return to_i32(imul_u(a, b))


## JS `v | 0` for an integer: wrap to signed 32 bits
static func to_i32(v: int) -> int:
	v &= MASK32
	return v - 0x100000000 if v >= 0x80000000 else v


## JS `v >>> 0` for an integer: wrap to unsigned 32 bits
static func to_u32(v: int) -> int:
	return v & MASK32


## JS `Math.round` (halves round up towards +infinity, unlike GDScript's `round`)
static func js_round(v: float) -> float:
	var f := floorf(v)
	return f + 1.0 if v - f >= 0.5 else f


## JS `Math.hypot(a, b)` exactly as V8 computes it (scaled by the larger value, Kahan sum);
## plain sqrt(a*a + b*b) differs in the last bit for a third of all inputs
static func hypot(a: float, b: float) -> float:
	a = absf(a)
	b = absf(b)
	var mx := 0.0
	if a > mx:
		mx = a
	if b > mx:
		mx = b
	if mx == INF:
		return INF
	if is_nan(a) or is_nan(b):
		return NAN
	if mx == 0.0:
		return 0.0
	var n0 := a / mx
	var n1 := b / mx
	return sqrt(n0 * n0 + n1 * n1) * mx


## mulberry32: a small fast generator; `next()` gives values in [0,1)
class Mulberry:
	var a: int

	func _init(seed_: int) -> void:
		a = seed_ & 0xFFFFFFFF

	func next() -> float:
		a = (a + 0x6d2b79f5) & 0xFFFFFFFF
		var t := a
		t = Rng.imul_u(t ^ (t >> 15), t | 1)
		t = t ^ ((t + Rng.imul_u(t ^ (t >> 7), t | 61)) & 0xFFFFFFFF)
		return float(t ^ (t >> 14)) / 4294967296.0


static func mulberry32(seed_: int) -> Mulberry:
	return Mulberry.new(seed_)


## a stable pseudo-random value in [0,1) for integer coordinates
static func hash2(x: int, y: int, s: int = 0) -> float:
	var h := (imul_u(x, 374761393) + imul_u(y, 668265263) + imul_u(s, 2147483647)) & MASK32
	h = imul_u(h ^ (h >> 13), 1274126177)
	h ^= h >> 16
	return float(h) / TWO32


static func hash3(x: int, y: int, z: int) -> float:
	return hash2(x + imul(z, 7919), y - imul(z, 104729), z)


## smooth value noise sampled at real coordinates; `cell` is the size of one lattice cell
static func value_noise(x: float, y: float, cell: float, seed_: int) -> float:
	var fx := x / cell
	var fy := y / cell
	var ixf := floorf(fx)
	var iyf := floorf(fy)
	var tx := fx - ixf
	var ty := fy - iyf
	var sx := tx * tx * (3.0 - 2.0 * tx)
	var sy := ty * ty * (3.0 - 2.0 * ty)
	var ix := int(ixf)
	var iy := int(iyf)
	var a := hash2(ix, iy, seed_)
	var b := hash2(ix + 1, iy, seed_)
	var c := hash2(ix, iy + 1, seed_)
	var d := hash2(ix + 1, iy + 1, seed_)
	return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy


## a few octaves of value noise, roughly in [0,1)
static func fbm(x: float, y: float, cell: float, seed_: int, octaves: int = 4) -> float:
	var sum := 0.0
	var amp := 1.0
	var norm := 0.0
	var c := cell
	for o in octaves:
		sum += value_noise(x, y, c, seed_ + o * 31) * amp
		norm += amp
		amp *= 0.5
		c *= 0.5
	return sum / norm
