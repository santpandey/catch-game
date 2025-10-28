import bpy
import math

# --- DEFINITIVE EXPORT SCRIPT --- 
# This script uses the working geometry creation and adds the correct hierarchy
# to solve the NODE_SKINNED_MESH_NON_ROOT error for a clean GLB export.

def clear_scene():
    """Wipes the scene clean."""
    if bpy.context.active_object and bpy.context.active_object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()

def lerp(a, b, t):
    """Linearly interpolate between two values."""
    return a + (b - a) * t

def interpolate_pose(start_pose, end_pose, factor):
    """Calculates an intermediate pose by interpolating between a start and end pose."""
    interp_pose = {}
    all_bones = set(start_pose.keys()) | set(end_pose.keys())
    for bone_name in all_bones:
        start_rot = start_pose.get(bone_name, (0, 0, 0))
        end_rot = end_pose.get(bone_name, (0, 0, 0))
        interp_rot = (lerp(start_rot[0], end_rot[0], factor), lerp(start_rot[1], end_rot[1], factor), lerp(start_rot[2], end_rot[2], factor))
        interp_pose[bone_name] = interp_rot
    return interp_pose

def create_single_rigged_hand(side_prefix):
    """Creates one complete, rigged hand object using the original, proven method."""
    x_mult = 1 if side_prefix == 'R' else -1
    parts = []
    
    # Create mesh parts
    bpy.ops.mesh.primitive_cube_add(location=(0, 0, 0)); palm = bpy.context.active_object
    palm.name = f"Palm.{side_prefix}"; palm.scale = (0.7, 1, 0.2); parts.append(palm)
    
    finger_mesh_data = [("Index", (-0.35, 0.85, 0), (0.18, 0.7, 0.18)), ("Middle", (-0.1, 0.9, 0), (0.2, 0.8, 0.2)), ("Ring", (0.15, 0.87, 0), (0.18, 0.75, 0.18)), ("Pinky", (0.4, 0.8, 0), (0.15, 0.6, 0.15))]
    for name, loc, scale in finger_mesh_data:
        bpy.ops.mesh.primitive_cube_add(location=(loc[0] * x_mult, loc[1], loc[2])); finger = bpy.context.active_object
        finger.name = f"{name}.{side_prefix}"; finger.scale = scale; parts.append(finger)
        
    bpy.ops.mesh.primitive_cube_add(location=(-0.6 * x_mult, 0.3, 0)); thumb = bpy.context.active_object
    thumb.name = f"Thumb.{side_prefix}"; thumb.scale = (0.2, 0.4, 0.2); parts.append(thumb)
    
    for part in parts:
        bpy.context.view_layer.objects.active = part
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        
    # Create armature
    bpy.ops.object.armature_add(enter_editmode=True, align='WORLD', location=(0,0,0)); armature = bpy.context.active_object
    armature.name = f"Armature.{side_prefix}"; edit_bones = armature.data.edit_bones
    palm_bone = edit_bones.get('Bone'); palm_bone.name = "Palm"; palm_bone.head, palm_bone.tail = (0, -0.5, 0), (0, 0.5, 0)
    
    finger_bone_data = [("Index", (-0.35, 0.5, 0), 0.35), ("Middle", (-0.1, 0.5, 0), 0.4), ("Ring", (0.15, 0.5, 0), 0.38), ("Pinky", (0.4, 0.5, 0), 0.3)]
    for name, pos, length in finger_bone_data:
        bone1 = edit_bones.new(f'{name}1'); bone1.head, bone1.tail = (pos[0]*x_mult, pos[1], 0), (pos[0]*x_mult, pos[1] + length, 0); bone1.parent = palm_bone
        bone2 = edit_bones.new(f'{name}2'); bone2.head, bone2.tail = (pos[0]*x_mult, pos[1] + length, 0), (pos[0]*x_mult, pos[1] + length * 2, 0); bone2.parent = bone1
        
    thumb1 = edit_bones.new('Thumb1'); thumb1.head, thumb1.tail = ((-0.6*x_mult, 0.2, 0), (-0.8*x_mult, 0.6, 0)); thumb1.parent = palm_bone
    bpy.ops.object.mode_set(mode='OBJECT')
    
    # Join parts into one mesh BEFORE parenting to armature
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = palm
    bpy.ops.object.join()
    hand_mesh = bpy.context.active_object
    hand_mesh.name = f"Hand_Mesh.{side_prefix}"

    # Add subdivision modifier
    bpy.ops.object.modifier_add(type='SUBSURF'); hand_mesh.modifiers["Subdivision"].levels = 2

    # --- HIERARCHY FIX --- 
    # 1. Parent mesh to armature to generate weights
    bpy.ops.object.select_all(action='DESELECT')
    hand_mesh.select_set(True)
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')

    # 2. Clear the parent to fix hierarchy, but keep the armature deform
    bpy.ops.object.select_all(action='DESELECT')
    hand_mesh.select_set(True)
    bpy.context.view_layer.objects.active = hand_mesh
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')

    # 3. Create a root empty and parent both mesh and armature to it
    bpy.ops.object.empty_add(type='PLAIN_AXES')
    root = bpy.context.active_object
    root.name = f"Root.{side_prefix}"
    hand_mesh.parent = root
    armature.parent = root
    
    return root, armature, hand_mesh

def set_and_keyframe_pose(armature, frame, pose_data):
    """Helper function to set a pose and insert keyframes for all specified bones."""
    bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode='POSE')
    pose_bones = armature.pose.bones
    for bone_name, rotation in pose_data.items():
        if bone_name in pose_bones:
            pose_bones[bone_name].rotation_mode = 'XYZ'
            pose_bones[bone_name].rotation_euler = [math.radians(deg) for deg in rotation]
            pose_bones[bone_name].keyframe_insert(data_path="rotation_euler")

def set_pose(armature, pose_data):
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode='POSE')
    for bone_name, (x, y, z) in pose_data.items():
        bone = armature.pose.bones.get(bone_name)
        if bone:
            bone.rotation_mode = 'XYZ'
            bone.rotation_euler.x = math.radians(x)
            bone.rotation_euler.y = math.radians(y)
            bone.rotation_euler.z = math.radians(z)
    bpy.ops.object.mode_set(mode='OBJECT')



def main():
    """Main function to create and animate the hands."""
    clear_scene()

    right_root, right_armature, right_mesh = create_single_rigged_hand('R')
    left_root, left_armature, left_mesh = create_single_rigged_hand('L')

    skin_material = bpy.data.materials.new(name="HandSkin")
    skin_material.use_nodes = True
    principled_bsdf = skin_material.node_tree.nodes.get('Principled BSDF')
    if principled_bsdf:
        principled_bsdf.inputs['Base Color'].default_value = (0.894, 0.71, 0.596, 1) # E4B598
        principled_bsdf.inputs['Roughness'].default_value = 0.8
    
    right_mesh.data.materials.append(skin_material)
    left_mesh.data.materials.append(skin_material)

    right_root.location.x = 0.09
    left_root.location.x = -0.09

    # --- Define Poses ---
    pose_open_r = {"Palm": (0, -75, -20), "Thumb1": (10, 45, -105), "Index1": (0, 0, -15), "Index2": (0,0,0), "Middle1": (0,0,0), "Middle2": (0,0,0), "Ring1": (0, 0, 15), "Ring2": (0,0,0), "Pinky1": (0, 0, 45), "Pinky2": (0, 0, -20)}
    pose_open_l = {"Palm": (0, 75, 20), "Thumb1": (10, -45, 105), "Index1": (0, 0, 15), "Index2": (0,0,0), "Middle1": (0,0,0), "Middle2": (0,0,0), "Ring1": (0, 0, -15), "Ring2": (0,0,0), "Pinky1": (0, 0, -45), "Pinky2": (0, 0, 20)}
    pose_catch_r = {"Palm": (0, -75, -20), "Thumb1": (13, 45, -105), "Index1": (85, 0, -15), "Index2": (90, 0, 0), "Middle1": (85, 0, 0), "Middle2": (90, 0, 0), "Ring1": (85, 0, 15), "Ring2": (90, 0, 0), "Pinky1": (85, 0, 45), "Pinky2": (90, 0, -20)}
    pose_catch_l = {"Palm": (0, 75, 20), "Thumb1": (13, -45, 105), "Index1": (85, 0, 15), "Index2": (90, 0, 0), "Middle1": (85, 0, 0), "Middle2": (90, 0, 0), "Ring1": (85, 0, -15), "Ring2": (90, 0, 0), "Pinky1": (85, 0, -45), "Pinky2": (90, 0, 20)}

    # --- Create Separate Animation Actions ---
    def create_action_for_pose(armature, action_name, pose_data):
        action = bpy.data.actions.new(name=action_name)
        if not armature.animation_data:
            armature.animation_data_create()
        armature.animation_data.action = action
        set_and_keyframe_pose(armature, 1, pose_data)
        # Stash the action in the NLA editor to ensure it's exported
        track = armature.animation_data.nla_tracks.new()
        track.name = action_name
        track.strips.new(name=action_name, start=1, action=action)

    # --- Set the final visual pose FIRST ---
    # This establishes the default state of the model before any animations are created.
    set_pose(right_armature, pose_open_r)
    set_pose(left_armature, pose_open_l)
    bpy.context.view_layer.update() # Force update to lock in the pose

    # --- Now, create and stash all animation actions ---
    # The script will temporarily change poses to keyframe, but will return to the default state.
    create_action_for_pose(right_armature, "Pose-Catch.R", pose_catch_r)
    create_action_for_pose(right_armature, "Pose-Open.R", pose_open_r)
    create_action_for_pose(left_armature, "Pose-Catch.L", pose_catch_l)
    create_action_for_pose(left_armature, "Pose-Open.L", pose_open_l)

    # --- Clear any lingering active animation to ensure the default pose is exported ---
    if right_armature.animation_data:
        right_armature.animation_data.action = None
    if left_armature.animation_data:
        left_armature.animation_data.action = None
    
    bpy.context.view_layer.update() # Final update for good measure

    bpy.context.scene.frame_set(1)

    # --- Export the entire scene ---
    # Since the scene is cleared at the start, we can safely export everything.
    # This is more reliable than exporting a selection of parented empties.
    filepath = "D:\\catch-game\\assets\\catching-hand-final.glb"

    bpy.ops.export_scene.gltf(
        filepath=filepath,
        use_selection=False,
        export_apply=True,
        export_materials='EXPORT',
        export_animations=True,
        export_nla_strips=True,
        export_rest_position_armature=False # Export the current pose, not the T-pose
    )

    print(f"--- SCRIPT FINISHED ---\nExported to {filepath}")

main()
