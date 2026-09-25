# scripts/build-mac-model.py
#
# Generates public/mac.glb: a classic Macintosh (128K-style) housing built
# procedurally in Blender from src/macintosh/macSpec.json, so the CRT picture
# rect the scene paints onto is known by construction (MacintoshScene.tsx reads
# the same spec). Run headless:
#
#   npm run model:mac
#   # = /Applications/Blender.app/Contents/MacOS/Blender -b -P scripts/build-mac-model.py
#
# Output is in macGroup-local units (see spec.scale), Y-up after glTF export:
# front face +Z, screen glass = separate mesh named "screen".

import json, math, os, sys
import bpy, bmesh
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPEC = json.load(open(os.path.join(ROOT, "src/macintosh/macSpec.json")))
OUT = os.path.join(ROOT, "public/mac.glb")
S = SPEC["scale"]

def u(inches):
    return inches * S

# ---------------------------------------------------------------- scene reset
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def material(name, srgb_hex, rough, metal=0.0, spec=0.5):
    """Base colour given as an sRGB hex (what you see); Blender/glTF store linear."""
    rgb = tuple(srgb_to_linear(int(srgb_hex[i:i + 2], 16) / 255) for i in (1, 3, 5))
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = spec
    return m

MAT_BODY = material("MacBody", "#d6cdb6", 0.58)    # classic platinum-beige case
MAT_BEZEL = material("MacBezel", "#e2dac6", 0.55)  # slightly lighter front panel
MAT_SCREEN = material("MacScreen", "#15181c", 0.22, spec=0.8)
MAT_DARK = material("MacSlot", "#2a2724", 0.75)

def add_box(name, size, center, mat=None):
    """Axis-aligned box. Blender is Z-up; we model with FRONT = -Y so the glTF
    exporter's Z-up→Y-up conversion lands the front on +Z."""
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=center)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if mat:
        ob.data.materials.append(mat)
    return ob

def add_rounded_rect_prism(name, w, h, r, depth, center, axis="y", mat=None, segs=8):
    """A rounded-rectangle extruded along `axis` (used as a boolean cutter or
    the glass). Built in the XZ plane (front-facing) then extruded along Y."""
    verts = []
    cx, cy, cz = center
    hw, hh = w / 2, h / 2
    corners = [(hw - r, hh - r, 0), (-hw + r, hh - r, math.pi / 2),
               (-hw + r, -hh + r, math.pi), (hw - r, -hh + r, 3 * math.pi / 2)]
    for (ox, oz, a0) in corners:
        for i in range(segs + 1):
            a = a0 + (i / segs) * (math.pi / 2)
            verts.append(Vector((ox + r * math.cos(a), 0.0, oz + r * math.sin(a))))
    bm = bmesh.new()
    front = [bm.verts.new(v + Vector((0, -depth / 2, 0))) for v in verts]
    back = [bm.verts.new(v + Vector((0, depth / 2, 0))) for v in verts]
    bm.faces.new(front)
    bm.faces.new(list(reversed(back)))
    n = len(front)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new([front[j], front[i], back[i], back[j]])
    bm.normal_update()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    ob.location = (cx, cy, cz)
    if mat:
        ob.data.materials.append(mat)
    return ob

def boolean(target, cutter, op="DIFFERENCE"):
    mod = target.modifiers.new(name=f"bool_{cutter.name}", type="BOOLEAN")
    mod.operation = op
    mod.object = cutter
    mod.solver = "EXACT"
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)

# ------------------------------------------------------------------ geometry
B = SPEC["body"]
W, H, D = u(B["w"]), u(B["h"]), u(B["d"])
bottom_z = u(SPEC["screenCenterLocal"][1] / S - SPEC["screenCenterFromBottom"])  # local units
# (screenCenterLocal is already in local units; convert the inch offset)
bottom_z = SPEC["screenCenterLocal"][1] - u(SPEC["screenCenterFromBottom"])
body_center = (0.0, 0.0, bottom_z + H / 2)
front_y = -D / 2   # front face plane (Blender -Y)

body = add_box("MacBody", (W, D, H), body_center, MAT_BODY)

# Top-back chamfer: the classic sloped rear top. Cut with a rotated slab whose
# lower edge runs from (fromFront behind the front face, at the top) down to
# the back face `drop` inches below the top.
TC = SPEC["topChamfer"]
top_z = bottom_z + H
p0 = Vector((0, front_y + u(TC["fromFront"]), top_z))
p1 = Vector((0, D / 2, top_z - u(TC["drop"])))
ang = math.atan2(p1.z - p0.z, p1.y - p0.y)  # negative: slopes down toward the back
slab_len = (p1 - p0).length * 2
cutter = add_box("cut_top", (W * 2, slab_len, u(3.0)), ((p0 + p1) / 2 + Vector((0, 0, u(1.5) * math.cos(ang))) ))
cutter.rotation_euler = (ang, 0, 0)
# nudge so the slab's bottom face passes through p0-p1
cutter.location = (p0 + p1) / 2 + Vector((0, -u(1.5) * math.sin(ang), u(1.5) * math.cos(ang)))
bpy.ops.object.transform_apply(rotation=True)
boolean(body, cutter)

# Base recess: the underside steps up toward the back so the case sits on a
# front "foot" (the real Mac's recessed base).
BR = SPEC["baseRecess"]
boolean(body, add_box("cut_base", (W * 2, u(BR["depth"]), u(BR["height"])),
                      (0, D / 2 - u(BR["depth"]) / 2, bottom_z + u(BR["height"]) / 2)))

# Front bezel: a shallow rounded-rect inset covering the front panel, giving
# the case its raised outer lip.
BZ = SPEC["bezel"]
bezel_w, bezel_h = W - 2 * u(BZ["inset"]), H - 2 * u(BZ["inset"])
boolean(body, add_rounded_rect_prism("cut_bezel", bezel_w, bezel_h, u(BZ["r"]), u(BZ["depth"]) * 2,
                                     (0, front_y, bottom_z + H / 2)))
bezel_y = front_y + u(BZ["depth"])   # recessed front panel plane

# Screen recess + glass.
G = SPEC["glass"]
screen_cz = SPEC["screenCenterLocal"][1]
boolean(body, add_rounded_rect_prism("cut_screen", u(G["w"]), u(G["h"]), u(G["r"]), u(G["recess"]) * 2,
                                     (0, bezel_y, screen_cz)))
glass_y = bezel_y + u(G["recess"])   # glass surface plane (recessed behind the bezel)
glass = add_rounded_rect_prism("screen", u(G["w"]) - u(0.02), u(G["h"]) - u(0.02), u(G["r"]),
                               u(0.12), (0, glass_y + u(0.06), screen_cz), mat=MAT_SCREEN)

# Floppy slot (right of centre in the chin) with a dark inner block behind it.
F = SPEC["floppy"]
slot_c = (u(F["x"]), bezel_y, bottom_z + u(F["y"]))
boolean(body, add_box("cut_floppy", (u(F["w"]), u(F["depth"]) * 2, u(F["h"])), slot_c))
# Dark block filling the slot from just behind the lip, so the visible
# walls are a hair deep and the slit reads as a black line.
add_box("slotInner", (u(F["w"]) - u(0.02), u(F["depth"]) - u(0.08), u(F["h"]) - u(0.02)),
        (slot_c[0], bezel_y + u(0.08) + (u(F["depth"]) - u(0.08)) / 2, slot_c[2]), MAT_DARK)

# Front panel gets the lighter bezel material: assign by face normal (-Y) after
# the booleans, so the recessed panel + screen well read as a separate part.
bpy.context.view_layer.objects.active = body
body.data.materials.append(MAT_BEZEL)
bpy.ops.object.mode_set(mode="EDIT")
bm = bmesh.from_edit_mesh(body.data)
for f in bm.faces:
    c = f.calc_center_median()
    if c.y < front_y + u(BZ["depth"]) + u(G["recess"]) + 0.001 and f.normal.y < -0.5:
        f.material_index = 1
bmesh.update_edit_mesh(body.data)
bpy.ops.object.mode_set(mode="OBJECT")

# Soften the case edges.
bev = body.modifiers.new("bevel", "BEVEL")
bev.width = u(SPEC["bevel"])
bev.segments = 3
bev.limit_method = "ANGLE"
bev.angle_limit = math.radians(40)
bpy.ops.object.modifier_apply(modifier="bevel")

# Flat everywhere except across the bevel rings: smooth-by-angle keeps every
# real edge (> 30°) crisp so the big front-panel n-gons shade flat, and only
# the rounded case edges blend.
for ob in (body, glass):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(30), keep_sharp_edges=True)

# ------------------------------------------------------------------- export
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_apply=True,
    export_yup=True,
    export_normals=True,
    export_materials="EXPORT",
    export_texcoords=False,
    export_animations=False,
    export_skins=False,
    export_extras=False,
    use_selection=True,
)

# Report the rects the scene relies on (macGroup-local, Y-up glTF space).
print("MAC_MODEL body local: x±%.3f  y %.3f..%.3f  z %.3f..%.3f" % (W / 2, bottom_z, top_z, -D / 2, D / 2))
print("MAC_MODEL glass: w %.4f h %.4f center y %.3f z(front of glass) %.4f" % (u(G["w"]), u(G["h"]), screen_cz, -(glass_y + u(0.12))))
print("MAC_MODEL picture: w %.4f h %.4f" % (u(SPEC["picture"]["w"]), u(SPEC["picture"]["h"])))
print("MAC_MODEL wrote", OUT, os.path.getsize(OUT), "bytes")
