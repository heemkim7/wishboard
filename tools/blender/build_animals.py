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
    bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=14, radius=radius, matrix=matrix)
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

def ball(name, loc, radius, mat, bone, scale=(1, 1, 1)):
    # One clean sphere on one bone. No remesh: fusing the face into the body is what made the chimera.
    obj = uv_sphere(name, loc, radius, mat, scale)
    assign_one(obj, bone)
    return obj

def mid(bone, t=0.5):
    head, tail = seg(bone)
    return head.lerp(tail, t)

def build(spec):
    prefix = spec["name"]
    cleanup(prefix)
    fur = material(prefix + "Fur", spec["fur"], 0.72)
    muzzle_mat = material(prefix + "Muzzle", spec["muzzle"], 0.55)
    nose_mat = material(prefix + "Nose", spec["nose"], 0.4)
    ear_mat = material(prefix + "Ear", spec["ear"], 0.55)
    eye_mat = material(prefix + "Eye", spec["eye_color"], 0.2)
    pupil_mat = material("Black", (0.07, 0.05, 0.06), 0.25)
    shine = material(prefix + "Shine", (1, 1, 1), 0.08)
    white = material(prefix + "White", (0.98, 0.97, 0.96), 0.48)
    head_r = spec["head_r"]
    head = mid("mixamorigHead", 0.35)
    front, up, right = Vector((0, -1, 0)), Vector((0, 0, 1)), Vector((1, 0, 0))
    ball(prefix + "Head", head, head_r, fur, "mixamorigHead", spec.get("head_scale", (1, 0.96, 1)))

    for x in (1, -1):
        if spec["ears"] == "pointy":
            base = head + right * (x * head_r * 0.42) + up * (head_r * 0.72) + front * (head_r * 0.05)
            tilt = (math.radians(-78), 0, math.radians(-16 * x))
            ear = cone(f"{prefix}Ear{x}", base, head_r * 0.34, head_r * 0.85, tilt, fur)
            inner = cone(f"{prefix}Inner{x}", base + front * 0.6 + up * 1.2, head_r * 0.18, head_r * 0.55, tilt, ear_mat)
            assign_one(ear, "mixamorigHead")
            assign_one(inner, "mixamorigHead")
        else:
            spot = head + right * (x * head_r * 0.62) + up * (head_r * 0.72)
            ball(f"{prefix}Ear{x}", spot, head_r * 0.34, fur, "mixamorigHead")
            ball(f"{prefix}Inner{x}", spot + front * (head_r * 0.12), head_r * 0.18, ear_mat, "mixamorigHead", (1, 0.45, 1))
        eye_at = head + right * (x * head_r * 0.34) + up * (head_r * 0.08) + front * (head_r * 0.78)
        eye_r = spec["eye"]
        ball(f"{prefix}Eye{x}", eye_at, eye_r, eye_mat, "mixamorigHead")
        ball(f"{prefix}Pupil{x}", eye_at + front * (eye_r * 0.72) + up * (eye_r * 0.05), eye_r * 0.62, pupil_mat, "mixamorigHead")
        ball(f"{prefix}Shine{x}", eye_at + front * (eye_r * 0.9) + up * (eye_r * 0.38) + right * (x * eye_r * 0.28), eye_r * 0.22, shine, "mixamorigHead")

    muzzle_at = head + front * (head_r * 0.62) + up * (-head_r * 0.28)
    ball(prefix + "Muzzle", muzzle_at, head_r * spec["muzzle_s"], muzzle_mat, "mixamorigHead", (1.25, 0.72, 0.7))
    ball(prefix + "Nose", muzzle_at + front * (head_r * 0.28) + up * (head_r * 0.08), head_r * 0.12, nose_mat, "mixamorigHead", (1.3, 0.75, 0.7))

    body = mid("mixamorigSpine", 0.2)
    body_r = spec["body_r"]
    ball(prefix + "Body", body, body_r, fur, "mixamorigSpine", (1.05, 0.92, 1.05))
    ball(prefix + "Belly", body + front * (body_r * 0.42) + up * (-body_r * 0.05), body_r * 0.62, white, "mixamorigSpine", (0.95, 0.42, 0.9))

    for side in ("Left", "Right"):
        ball(f"{prefix}{side}Arm", mid(f"mixamorig{side}Arm", 0.65), spec["limb"], fur, f"mixamorig{side}Arm")
        elbow = seg(f"mixamorig{side}ForeArm")[0]
        ball(f"{prefix}{side}Paw", elbow, spec["limb"] * 1.15, white, f"mixamorig{side}ForeArm")
        ball(f"{prefix}{side}Thigh", mid(f"mixamorig{side}UpLeg", 0.45), spec["limb"] * 1.15, fur, f"mixamorig{side}UpLeg")
        ball(f"{prefix}{side}Calf", mid(f"mixamorig{side}Leg", 0.4), spec["limb"] * 0.95, fur, f"mixamorig{side}Leg")
        ankle = seg(f"mixamorig{side}Foot")[0]
        ball(f"{prefix}{side}Foot", ankle + front * 2.4 + up * (-1.6), spec["limb"] * 1.2, white, f"mixamorig{side}Foot", (1.05, 1.35, 0.72))

    hip = seg("mixamorigHips")[0]
    for i, (offset, radius) in enumerate(spec["tail"]):
        ball(f"{prefix}Tail{i}", hip + Vector(offset), radius, fur, "mixamorigHips")
    print(prefix, "chibi")

CAT = dict(
    name="Cat",
    fur=(0.78, 0.72, 0.68), muzzle=(0.99, 0.98, 0.97), nose=(0.96, 0.55, 0.62),
    ear=(0.98, 0.62, 0.7), eye_color=(0.98, 0.86, 0.28),
    head_r=16.5, body_r=14.2, limb=6.4, ears="pointy", eye=4.4, muzzle_s=0.42,
    tail=[((0, 7, 1), 4.0), ((0, 12, 7), 3.4), ((0, 14, 14), 2.8), ((0, 12, 21), 2.2)],
)
BEAR = dict(
    name="Bear",
    fur=(0.62, 0.4, 0.22), muzzle=(0.98, 0.9, 0.78), nose=(0.12, 0.08, 0.07),
    ear=(0.84, 0.58, 0.4), eye_color=(0.97, 0.96, 0.94),
    head_r=17.2, body_r=16.4, limb=7.2, ears="round", eye=3.6, muzzle_s=0.5,
    head_scale=(1.08, 0.98, 0.96),
    tail=[((0, 8, 2), 4.6)],
)

if __name__ == "__main__":
    build(CAT)
    build(BEAR)
    arm.hide_set(True)
    print("BUILT")
