# Clothed biped cat and bear on the Mixamo armature. Fur keeps its color.
# The shirt material is named Main so the game tints only the clothes.
import math
import bpy
import bmesh
from mathutils import Vector, Matrix, Euler

arm = bpy.data.objects["Armature"]
arm.data.pose_position = "REST"
bpy.context.view_layer.update()
mouse = bpy.data.objects.get("Ch14")
if mouse:
    mouse.hide_set(True)
    mouse.hide_render = True

def view3d():
    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            if area.type != "VIEW_3D":
                continue
            region = next(region for region in area.regions if region.type == "WINDOW")
            return {"window": window, "screen": window.screen, "area": area, "region": region}
    raise RuntimeError("no 3D view")

def in_view(fn):
    with bpy.context.temp_override(**view3d()):
        if bpy.context.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
        return fn()

def cleanup(prefix):
    for obj in list(bpy.data.objects):
        if obj.name.startswith(prefix):
            data = obj.data if obj.type == "MESH" else None
            bpy.data.objects.remove(obj, do_unlink=True)
            if data and data.users == 0:
                bpy.data.meshes.remove(data)

def seg(name):
    bone = arm.data.bones[name]
    world = arm.matrix_world
    return (world @ bone.head_local).copy(), (world @ bone.tail_local).copy()

def material(name, color, rough=0.5):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = 0.0
    for key in ("Specular IOR Level", "Specular"):
        sock = bsdf.inputs.get(key)
        if sock:
            sock.default_value = 0.22
    return mat

def new_object(name, bm, mat):
    mesh = bpy.data.meshes.new(name + "Mesh")
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    if mat:
        obj.data.materials.append(mat)
    return obj

def uv_sphere(name, loc, radius, mat, scale=(1, 1, 1)):
    bm = bmesh.new()
    matrix = Matrix.Translation(Vector(loc)) @ Matrix.Diagonal(Vector((scale[0], scale[1], scale[2], 1))).to_4x4()
    bmesh.ops.create_uvsphere(bm, u_segments=14, v_segments=10, radius=radius, matrix=matrix)
    return new_object(name, bm, mat)

def cone(name, loc, radius, depth, euler, mat):
    bm = bmesh.new()
    matrix = Matrix.Translation(Vector(loc)) @ Euler(euler, "XYZ").to_matrix().to_4x4()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=radius, radius2=radius * 0.15, depth=depth, matrix=matrix)
    return new_object(name, bm, mat)

def whisker(name, a, b, radius, mat):
    a, b = Vector(a), Vector(b)
    direction = b - a
    quat = Vector((0, 0, 1)).rotation_difference(direction.normalized())
    matrix = Matrix.Translation((a + b) / 2) @ quat.to_matrix().to_4x4()
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=5, radius1=radius, radius2=radius * 0.4, depth=direction.length, matrix=matrix)
    return new_object(name, bm, mat)

def join(parts, name, mat):
    bm = bmesh.new()
    for obj in parts:
        part = bmesh.new()
        part.from_mesh(obj.data)
        part.transform(obj.matrix_world)
        verts = [bm.verts.new(v.co) for v in part.verts]
        bm.verts.ensure_lookup_table()
        for face in part.faces:
            try:
                bm.faces.new([verts[v.index] for v in face.verts])
            except ValueError:
                pass
        part.free()
        bpy.data.objects.remove(obj, do_unlink=True)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.05)
    bm.normal_update()
    return new_object(name, bm, mat)

def fuse(obj, voxel=1.65):
    def run():
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        remesh = obj.modifiers.new("Remesh", "REMESH")
        remesh.mode = "VOXEL"
        remesh.voxel_size = voxel
        bpy.ops.object.modifier_apply(modifier="Remesh")
        smooth = obj.modifiers.new("Smooth", "SMOOTH")
        smooth.iterations = 5
        smooth.factor = 0.45
        bpy.ops.object.modifier_apply(modifier="Smooth")
        for poly in obj.data.polygons:
            poly.use_smooth = True
    in_view(run)
    return obj

def chain(bucket, name, points, mat):
    made = []
    for i, (loc, radius) in enumerate(points):
        made.append(uv_sphere(f"{name}{i}", loc, radius, mat))
    bucket.extend(made)

def along(bucket, name, bone, radius, mat, inset=0.12):
    head, tail = seg(bone)
    length = (tail - head).length
    count = max(2, int(length / max(radius * 0.7, 1)))
    for i in range(count):
        t = inset + (1 - 2 * inset) * (i + 0.5) / count
        chain(bucket, f"{name}{i}", [(head.lerp(tail, t), radius)], mat)

def bind(obj):
    world = obj.matrix_world.copy()
    obj.parent = arm
    obj.matrix_world = world
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm

def assign_one(obj, bone):
    group = obj.vertex_groups.new(name=bone)
    group.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    bind(obj)

def dist_segment(point, head, tail):
    span = tail - head
    length2 = span.length_squared
    if length2 < 1e-8:
        return (point - head).length
    t = max(0.0, min(1.0, (point - head).dot(span) / length2))
    return (point - (head + span * t)).length

ALLOWED = {
    "Head": ("mixamorigHead", "mixamorigNeck"),
    "Shirt": ("mixamorigHips", "mixamorigSpine", "mixamorigSpine1", "mixamorigSpine2", "mixamorigNeck"),
    "Sleeve": ("mixamorigLeftShoulder", "mixamorigRightShoulder", "mixamorigLeftArm", "mixamorigRightArm", "mixamorigLeftForeArm", "mixamorigRightForeArm", "mixamorigLeftHand", "mixamorigRightHand"),
    "Pant": ("mixamorigHips", "mixamorigLeftUpLeg", "mixamorigRightUpLeg", "mixamorigLeftLeg", "mixamorigRightLeg"),
    "Shoe": ("mixamorigLeftLeg", "mixamorigRightLeg", "mixamorigLeftFoot", "mixamorigRightFoot", "mixamorigLeftToeBase", "mixamorigRightToeBase"),
}

def weight(obj, kind):
    names = ALLOWED[kind]
    bones = []
    for name in names:
        head, tail = seg(name)
        radius = 16 if "Head" in name or "Spine" in name or name.endswith("Hips") else 12
        bones.append((name, head, tail, radius))
        obj.vertex_groups.new(name=name)
    for vert in obj.data.vertices:
        point = obj.matrix_world @ vert.co
        scored = []
        nearest, nearest_d = bones[0][0], 1e9
        for name, head, tail, radius in bones:
            dist = dist_segment(point, head, tail)
            if dist < nearest_d:
                nearest, nearest_d = name, dist
            influence = max(0.0, 1.0 - dist / radius)
            if influence > 0:
                scored.append((name, influence ** 2))
        if not scored:
            scored = [(nearest, 1.0)]
        scored.sort(key=lambda item: -item[1])
        total = sum(w for _, w in scored[:2]) or 1
        for name, w in scored[:2]:
            obj.vertex_groups[name].add([vert.index], w / total, "REPLACE")
    bind(obj)

def solid(parts, name, mat, voxel, kind):
    obj = fuse(join(parts, name, mat), voxel)
    if kind:
        weight(obj, kind)
    return obj

def build(spec):
    prefix = spec["name"]
    cleanup(prefix)
    fur = material(prefix + "Fur", spec["fur"], 0.62)
    muzzle_mat = material(prefix + "Muzzle", spec["muzzle"], 0.5)
    nose_mat = material(prefix + "Nose", spec["nose"], 0.35)
    ear_mat = material(prefix + "Ear", spec["ear"], 0.45)
    eye_mat = material(prefix + "Eye", spec.get("eye_color", (0.97, 0.98, 1)), 0.18)
    pupil_mat = material("Black", (0.05, 0.04, 0.06), 0.2)
    white = material(prefix + "White", (0.97, 0.97, 0.98), 0.42)
    furry = spec.get("cloth") == "fur"
    shirt = fur if furry else material("Main", (0.25, 0.78, 0.95), 0.42)
    pants = fur if furry else material(prefix + "Pants", spec["pants"], 0.55)
    shoes = white if furry else material(prefix + "Shoe", (0.12, 0.1, 0.09), 0.4)
    paw_mat = white if furry else fur
    body = spec["body"]
    head = Vector(spec["head"])
    head_r = spec["head_r"]

    head_bits = []
    chain(head_bits, prefix + "Head", [(head, head_r)], fur)
    chain(head_bits, prefix + "Snout", [(head + Vector((0, -head_r * 0.62, -head_r * 0.08)), head_r * 0.4)], fur)
    chain(head_bits, prefix + "CheekL", [(head + Vector((head_r * 0.42, -head_r * 0.22, -head_r * 0.02)), head_r * 0.26)], fur)
    chain(head_bits, prefix + "CheekR", [(head + Vector((-head_r * 0.42, -head_r * 0.22, -head_r * 0.02)), head_r * 0.26)], fur)
    if spec["ears"] == "pointy":
        for x in (1, -1):
            tilt = (math.radians(-8), math.radians(-28 * x), math.radians(6 * x))
            base = head + Vector((x * head_r * 0.42, head_r * 0.08, head_r * 0.78))
            ear_r = head_r * (0.52 if furry else 0.34)
            ear_d = head_r * (1.55 if furry else 1.15)
            head_bits.append(cone(f"{prefix}Ear{x}", base, ear_r, ear_d, tilt, fur))
    else:
        for x in (1, -1):
            chain(head_bits, f"{prefix}Ear{x}", [(head + Vector((x * head_r * 0.7, 0.2, head_r * 0.58)), head_r * 0.36)], fur)
    solid(head_bits, prefix + "Head", fur, 1.5, "Head")

    shirt_bits = []
    chain(shirt_bits, prefix + "Torso", [
        ((0, 0.4, 36), 13.2 * body),
        ((0, -1.2, 50), 16.5 * body if furry else 13.5 * body),
        ((0, -1.6, 62), 15.4 * body),
        ((0, -0.6, 72), 10.4 * body),
    ], shirt)
    solid(shirt_bits, prefix + "Shirt", shirt, 1.7, "Shirt")
    if furry:
        belly = uv_sphere(prefix + "Belly", (0, -14 * body, 50), 11.5 * body, white, (0.9, 0.42, 1.15))
        weight(belly, "Shirt")

    for side, sign in (("Left", 1), ("Right", -1)):
        sleeve = []
        along(sleeve, f"{prefix}{side}Sh", f"mixamorig{side}Shoulder", 6.4 * body, shirt)
        along(sleeve, f"{prefix}{side}Arm", f"mixamorig{side}Arm", 5.8 * body, shirt)
        along(sleeve, f"{prefix}{side}Fore", f"mixamorig{side}ForeArm", 5.2 * body, shirt)
        solid(sleeve, f"{prefix}{side}Sleeve", shirt, 1.55, "Sleeve")
        wrist, palm = seg(f"mixamorig{side}Hand")
        paw = uv_sphere(f"{prefix}{side}Paw", wrist.lerp(palm, 0.55), (8.2 if furry else 6.4) * body, paw_mat)
        assign_one(paw, f"mixamorig{side}Hand")
        t0, t1 = seg(f"mixamorig{side}HandThumb1")
        thumb = uv_sphere(f"{prefix}{side}Thumb", t0.lerp(t1, 0.6), 3.3 if furry else 3.1, paw_mat)
        assign_one(thumb, f"mixamorig{side}HandThumb1")

        pant = []
        along(pant, f"{prefix}{side}Thigh", f"mixamorig{side}UpLeg", 7.2 * body, pants)
        along(pant, f"{prefix}{side}Calf", f"mixamorig{side}Leg", 5.8 * body, pants)
        solid(pant, f"{prefix}{side}Pant", pants, 1.55, "Pant")
        shoe = []
        along(shoe, f"{prefix}{side}Foot", f"mixamorig{side}Foot", 5.2 * body, shoes, 0.05)
        along(shoe, f"{prefix}{side}Toe", f"mixamorig{side}ToeBase", 4.6 * body, shoes, 0.08)
        solid(shoe, f"{prefix}{side}Shoe", shoes, 1.45, "Shoe")

    tail_bits = []
    chain(tail_bits, prefix + "Tail", spec["tail"], fur)
    tail = solid(tail_bits, prefix + "Tail", fur, 1.45, None)
    assign_one(tail, "mixamorigHips")

    extras = []
    for x in (1, -1):
        direction = Vector((x * 0.32, -0.88, 0.22)).normalized()
        eye_r = spec["eye"]
        extras.append(uv_sphere(f"{prefix}Eye{x}", head + direction * (head_r - eye_r * 0.15), eye_r, eye_mat))
        extras.append(uv_sphere(f"{prefix}Pupil{x}", head + direction * (head_r + eye_r * 0.35), eye_r * 0.55, pupil_mat))
        if spec["ears"] == "pointy":
            tilt = (math.radians(-8), math.radians(-28 * x), math.radians(6 * x))
            inner = head + Vector((x * head_r * (0.46 if furry else 0.4), -head_r * 0.05, head_r * (1.05 if furry else 0.88)))
            extras.append(cone(f"{prefix}Inner{x}", inner, head_r * (0.28 if furry else 0.16), head_r * (0.95 if furry else 0.62), tilt, ear_mat))
        else:
            extras.append(uv_sphere(f"{prefix}Inner{x}", head + Vector((x * head_r * 0.7, -head_r * 0.1, head_r * 0.58)), head_r * 0.18, ear_mat, (1, 0.4, 1)))
    snout = Vector((0, -0.9, -0.12)).normalized()
    extras.append(uv_sphere(f"{prefix}Muzzle", head + snout * head_r * 0.72, head_r * spec["muzzle_s"], muzzle_mat, (1.2, 0.75, 0.65)))
    extras.append(uv_sphere(f"{prefix}Nose", head + snout * head_r * 1.02, head_r * 0.13, nose_mat, (1.35, 0.7, 0.6)))
    if spec.get("whiskers"):
        origin = head + snout * head_r * 0.95
        for i, lift in enumerate((-1.0, 0.8, 2.4)):
            for x in (1, -1):
                start = origin + Vector((x * 1.4, 0, lift))
                end = start + Vector((x * 11, -4.5, lift * 0.45))
                extras.append(whisker(f"{prefix}Whisk{x}{i}", start, end, 0.38, pupil_mat))
    for extra in extras:
        assign_one(extra, "mixamorigHead")
    print(prefix, "done", len(extras))

CAT = dict(
    name="Cat", cloth="fur",
    fur=(0.62, 0.64, 0.68), muzzle=(0.98, 0.98, 0.99), nose=(0.08, 0.07, 0.08),
    ear=(0.98, 0.55, 0.66), pants=(0.62, 0.64, 0.68), body=1.05,
    eye_color=(0.78, 0.88, 0.22),
    head=(0, 1.2, 98), head_r=22, ears="pointy", eye=5.1, muzzle_s=0.46, whiskers=True,
    tail=[((0, 12, 42), 5.6), ((0, 18, 48), 5.0), ((0, 24, 56), 4.4), ((0, 28, 66), 3.8), ((0, 28, 76), 3.2), ((0, 24, 84), 2.6)],
)
BEAR = dict(
    name="Bear", fur=(0.34, 0.21, 0.12), muzzle=(0.95, 0.86, 0.72), nose=(0.08, 0.05, 0.04),
    ear=(0.48, 0.3, 0.18), pants=(0.14, 0.1, 0.08), body=1.18,
    head=(0, 1.0, 98), head_r=21.5, ears="round", eye=3.5, muzzle_s=0.42, whiskers=False,
    tail=[((0, 14, 42), 5.4), ((0, 18, 46), 4.2)],
)

if __name__ == "__main__":
    build(CAT)
    build(BEAR)
    arm.hide_set(True)
    print("BUILT")
