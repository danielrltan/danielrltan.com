# scripts/build-keypad-model.py
#
# Generates public/keypad.glb: the Contact keypad (display + cat dial + four
# social keycaps + two side buttons) built procedurally in Blender from
# src/keypad/keypadSpec.json, so its proportions are spec numbers, not hand
# edits. Replaces the hand-exported model whose low-segment chamfers shaded as
# visible triangles (owner, 2026-10-05: "the triangles on it are like fucked
# up and the reflection is all wonky"). Run headless:
#
#   npm run model:keypad
#   # = /Applications/Blender.app/Contents/MacOS/Blender -b -P scripts/build-keypad-model.py
#
# CONTRACT with src/keypad/KeypadModel.tsx (keep it when editing):
#   - nodes "frame", "knob", "github", "linkedin", "x", "pinterest", "display"
#   - every keycap node's origin at its own centre (pressed along local Y)
#   - "knob" origin on its own spin axis (KeypadModel spins rotation.y)
#   - glTF space: slab in XZ, tops face +Y, display toward -Z, 2x2 keys:
#       github (-x,-z)  linkedin (+x,-z)  x (-x,+z)  pinterest (+x,+z)
# Blender is Z-up; the glTF exporter maps Blender (x, y, z) -> glTF (x, z, -y),
# so everything below is laid out in glTF terms and converted by B().

import json, math, os
import bpy, bmesh
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPEC = json.load(open(os.path.join(ROOT, "src/keypad/keypadSpec.json")))
TEX = os.path.join(ROOT, "blend-src/keypad/tex")
OUT = os.path.join(ROOT, "public/keypad.glb")


def B(gx, gy, gz):
    """glTF-space point -> Blender-space vector."""
    return Vector((gx, -gz, gy))


# ---------------------------------------------------------------- scene reset
bpy.ops.wm.read_factory_settings(use_empty=True)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def material(name, hex_=None, rough=0.5, metal=0.0, image=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    if hex_:
        rgb = tuple(srgb_to_linear(int(hex_[i:i + 2], 16) / 255) for i in (1, 3, 5))
        bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    if image:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(os.path.join(TEX, image))
        tex.interpolation = "Linear"
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    return m


MS = SPEC["materials"]
MAT_BODY = material("BrushedMetal", MS["BrushedMetal"]["hex"], MS["BrushedMetal"]["rough"], MS["BrushedMetal"]["metal"])
MAT_CAP = material("keycap", MS["keycap"]["hex"], MS["keycap"]["rough"], MS["keycap"]["metal"])
MAT_DARK = material("dark", MS["dark"]["hex"], MS["dark"]["rough"], MS["dark"]["metal"])
MAT_ORANGE = material("orange", MS["orange"]["hex"], MS["orange"]["rough"], MS["orange"]["metal"])
MAT_DISPLAY = material("display", None, MS["display"]["rough"], MS["display"]["metal"], "display.png")
MAT_ICON = {
    n: material(n, None, MS["icon"]["rough"], MS["icon"]["metal"], n + ".png")
    for n in ("github", "linkedin", "x", "pinterest", "cat")
}


# ---------------------------------------------------------------- helpers
def rrect_loop(w, d, r, segs):
    """Rounded-rect outline in the glTF XZ plane, centred at 0 (list of (x, z))."""
    r = min(r, w / 2 - 1e-4, d / 2 - 1e-4)
    hw, hd = w / 2, d / 2
    pts = []
    corners = [(hw - r, -hd + r, -math.pi / 2), (hw - r, hd - r, 0.0),
               (-hw + r, hd - r, math.pi / 2), (-hw + r, -hd + r, math.pi)]
    for (cx, cz, a0) in corners:
        for i in range(segs + 1):
            a = a0 + (i / segs) * (math.pi / 2)
            pts.append((cx + r * math.cos(a), cz + r * math.sin(a)))
    return pts


def prism(name, w, d, r, y0, y1, cx=0.0, cz=0.0, segs=12, top_scale=1.0, mat=None):
    """Rounded-rect prism from glTF y0 to y1 (optionally tapered at the top)."""
    loop = rrect_loop(w, d, r, segs)
    bm = bmesh.new()
    bot = [bm.verts.new(B(cx + x, y0, cz + z)) for (x, z) in loop]
    top = [bm.verts.new(B(cx + x * top_scale, y1, cz + z * top_scale)) for (x, z) in loop]
    bm.faces.new(list(reversed(bot)))
    bm.faces.new(top)
    n = len(loop)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((bot[i], bot[j], top[j], top[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    if mat:
        ob.data.materials.append(mat)
    return ob


def cylinder(name, r, y0, y1, cx, cz, segs=96, mat=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=segs, radius=r, depth=y1 - y0,
                                        location=B(cx, (y0 + y1) / 2, cz))
    ob = bpy.context.active_object
    ob.name = name
    if mat:
        ob.data.materials.append(mat)
    return ob


def activate(ob):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def boolean(target, cutter, op="DIFFERENCE"):
    mod = target.modifiers.new("bool", "BOOLEAN")
    mod.operation = op
    mod.object = cutter
    mod.solver = "EXACT"
    activate(target)
    bpy.ops.object.modifier_apply(modifier="bool")
    bpy.data.objects.remove(cutter, do_unlink=True)


def bevel(ob, width, segs, angle=40, harden=True):
    """Round every edge sharper than `angle`, with enough segments that the
    curve reads smooth, then shade it smooth by angle so flat faces stay flat
    and only the rounds blend. Harden normals keeps flat faces truly flat next
    to a round (no gradient smear, which is what made the old caps faceted)."""
    mod = ob.modifiers.new("bevel", "BEVEL")
    mod.width = width
    mod.segments = segs
    mod.limit_method = "ANGLE"
    mod.angle_limit = math.radians(angle)
    mod.harden_normals = harden
    mod.profile = 0.5
    activate(ob)
    bpy.ops.object.shade_smooth()
    bpy.ops.object.modifier_apply(modifier="bevel")
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35), keep_sharp_edges=True)


def set_origin(ob, g_point):
    """Move the object's origin to a glTF-space point (geometry stays put)."""
    activate(ob)
    bpy.context.scene.cursor.location = B(*g_point)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")


def map_top(ob, mat, top_y, cx, cz, size_x, size_z, tol=1e-3):
    """Faces that are flat and facing up at top_y get `mat` and a planar UV
    covering size_x x size_z centred on (cx, cz). Other faces keep slot 0."""
    if mat.name not in [m.name for m in ob.data.materials]:
        ob.data.materials.append(mat)
    slot = [m.name for m in ob.data.materials].index(mat.name)
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv.verify()
    mw = ob.matrix_world
    up = Vector((0, 0, 1))
    for f in bm.faces:
        n = (mw.to_3x3() @ f.normal).normalized()
        c = mw @ f.calc_center_median()
        is_top = n.dot(up) > 0.999 and abs(c.z - top_y) < tol
        for loop in f.loops:
            p = mw @ loop.vert.co
            gx, gz = p.x, -p.y
            loop[uv].uv = ((gx - cx) / size_x + 0.5, 0.5 - (gz - cz) / size_z)
        if is_top:
            f.material_index = slot
    bm.to_mesh(me)
    bm.free()


# ---------------------------------------------------------------- layout
BD = SPEC["body"]
M = SPEC["margin"]
TR = SPEC["topRow"]
WL = SPEC["well"]
KY = SPEC["keys"]
DS = SPEC["display"]
KN = SPEC["knob"]
SB = SPEC["sideButtons"]

W, D = BD["w"], BD["d"]
Y0, Y1 = BD["y0"], BD["y1"]
z_top = -D / 2 + M                    # top row, display side (-Z)
z_row_end = z_top + TR["h"]
z_well0 = z_row_end + TR["gapBelow"]
z_well1 = D / 2 - M
well_w = W - 2 * M
well_d = z_well1 - z_well0
well_cz = (z_well0 + z_well1) / 2
well_floor = Y1 - WL["depth"]
key = (well_w - 2 * WL["pad"] - KY["gap"]) / 2
key_d = (well_d - 2 * WL["pad"] - KY["gap"]) / 2
row_cz = (z_top + z_row_end) / 2

# ---------------------------------------------------------------- body
body = prism("frame", W, D, BD["corner"], Y0, Y1, segs=16, mat=MAT_BODY)
# Key well.
boolean(body, prism("cut_well", well_w, well_d, WL["corner"], well_floor, Y1 + 0.5, 0.0, well_cz, segs=12))
# Display recess.
disp_x0 = -W / 2 + M
disp_cx = disp_x0 + DS["w"] / 2
boolean(body, prism("cut_disp", DS["w"], TR["h"], DS["corner"], Y1 - DS["recess"], Y1 + 0.5, disp_cx, row_cz, segs=10))
bevel(body, BD["edgeBevel"], BD["bevelSegs"])

# Dark well floor (a thin plate so the keys pop off a dark ground).
floor = prism("well_floor", well_w - 0.02, well_d - 0.02, WL["corner"] - 0.01, well_floor, well_floor + 0.004,
              0.0, well_cz, segs=12, mat=MAT_DARK)

# Display glass.
disp_y = Y1 - DS["recess"] + 0.004
disp_w = DS["w"] - 2 * DS["inset"]
disp_d = TR["h"] - 2 * DS["inset"]
display = prism("display", disp_w, disp_d, DS["corner"] * 0.6, disp_y - 0.004, disp_y, disp_cx, row_cz, segs=8, mat=MAT_DISPLAY)
map_top(display, MAT_DISPLAY, disp_y, disp_cx, row_cz, disp_w, disp_d)
activate(display)
bpy.ops.object.shade_flat()

# ---------------------------------------------------------------- keycaps
caps = {"github": (-1, -1), "linkedin": (1, -1), "x": (-1, 1), "pinterest": (1, 1)}
pitch_x = key + KY["gap"]
pitch_z = key_d + KY["gap"]
cap_y0 = well_floor + 0.004
cap_y1 = cap_y0 + KY["height"]
for name, (sx, sz) in caps.items():
    cx = sx * pitch_x / 2
    cz = well_cz + sz * pitch_z / 2
    cap = prism(name, key, key_d, KY["corner"], cap_y0, cap_y1, cx, cz, segs=12, top_scale=KY["taper"], mat=MAT_CAP)
    bevel(cap, KY["topBevel"], KY["bevelSegs"], angle=30)
    top_w = key * KY["taper"] - 2 * KY["topBevel"]
    top_d = key_d * KY["taper"] - 2 * KY["topBevel"]
    # The icon art is a circle on white: map it over the cap's whole top so the
    # badge sits centred with an even white rim.
    map_top(cap, MAT_ICON[name], cap_y1, cx, cz, key * KY["taper"] * 0.92, key_d * KY["taper"] * 0.92)
    set_origin(cap, (cx, (cap_y0 + cap_y1) / 2, cz))

# ---------------------------------------------------------------- knob (cat dial)
knob_cx = W / 2 - M - KN["r"] * 0.55
knob_cz = row_cz
collar = cylinder("knob_collar", KN["collarR"], Y1 - 0.01, Y1 + KN["collarH"], knob_cx, knob_cz, mat=MAT_DARK)
kb0 = Y1 + KN["collarH"]
kb1 = kb0 + KN["h"]
knob = cylinder("knob", KN["r"], kb0, kb1, knob_cx, knob_cz, segs=72, mat=MAT_BODY)
# Knurled grip: shallow vertical grooves around the side.
for i in range(KN["ridges"]):
    a = i / KN["ridges"] * 2 * math.pi
    gx = knob_cx + math.cos(a) * (KN["r"] + 0.012)
    gz = knob_cz + math.sin(a) * (KN["r"] + 0.012)
    groove = cylinder("groove", 0.028, kb0 + 0.09, kb1 - 0.1, gx, gz, segs=8)
    boolean(knob, groove)
bevel(knob, KN["topBevel"], 5, angle=50)
map_top(knob, MAT_ICON["cat"], kb1, knob_cx, knob_cz, (KN["r"] - KN["topBevel"]) * 2 * 1.06, (KN["r"] - KN["topBevel"]) * 2 * 1.06)
set_origin(knob, (knob_cx, (kb0 + kb1) / 2, knob_cz))
# The collar is part of the static frame (it doesn't spin).
activate(collar)
bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))

# ---------------------------------------------------------------- side buttons
for i, bz in enumerate(SB["z"]):
    btn = prism("side_btn_%d" % i, SB["thick"] * 2, SB["len"], SB["corner"], SB["y"] - SB["tall"] / 2,
                SB["y"] + SB["tall"] / 2, SB["x"], bz, segs=8, mat=MAT_ORANGE)
    bevel(btn, SB["corner"] * 0.9, 5, angle=30)

# Join the static parts into "frame" (one node, several materials).
activate(body)
for ob in list(bpy.data.objects):
    if ob.name.startswith(("well_floor", "knob_collar", "side_btn_")):
        ob.select_set(True)
bpy.ops.object.join()
body.name = "frame"
body.data.name = "frame"

for ob in bpy.data.objects:
    if ob.type == "MESH":
        ob.data.name = ob.name

# ------------------------------------------------------------------- export
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_apply=True,
    export_yup=True,
    export_normals=True,
    export_texcoords=True,
    export_materials="EXPORT",
    export_image_format="WEBP",
    export_animations=False,
    export_skins=False,
    export_extras=False,
    use_selection=True,
)

print("KEYPAD_MODEL body %.2f x %.2f, y %.2f..%.2f; key %.3f x %.3f; well floor %.3f; caps top %.3f"
      % (W, D, Y0, Y1, key, key_d, well_floor, cap_y1))
print("KEYPAD_MODEL knob centre x %.3f z %.3f r %.2f top %.3f" % (knob_cx, knob_cz, KN["r"], kb1))
print("KEYPAD_MODEL wrote", OUT, os.path.getsize(OUT), "bytes")
