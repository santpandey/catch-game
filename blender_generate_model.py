import bpy
import math

# --- SCRIPT 1 of 2: GENERATE BASE MODEL --- 
# This script's only job is to create the hands and export them in the correct
# default "open" pose. It contains NO animation data for other poses to ensure
# a clean, uncorrupted export.

def clear_scene():
    """Wipes the scene clean."""
    if bpy.context.active_object and bpy.context.active_object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()

def build_materials():
    """Creates the skin and jersey materials."""
    skin = bpy.data.materials.new(name="HandSkin")
    skin.use_nodes = True
    bsdf = skin.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Base Color'].default_value = (0.894, 0.71, 0.596, 1) # E4B598
        bsdf.inputs['Roughness'].default_value = 0.55
        subsurface = bsdf.inputs.get('Subsurface Weight') or bsdf.inputs.get('Subsurface')
        if subsurface:
            subsurface.default_value = 0.05
        nodes = skin.node_tree.nodes
        links = skin.node_tree.links
        noise = nodes.new('ShaderNodeTexNoise')
        noise.inputs['Scale'].default_value = 18
        noise.inputs['Detail'].default_value = 3
        bump = nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = 0.25
        bump.inputs['Distance'].default_value = 0.08
        links.new(noise.outputs['Fac'], bump.inputs['Height'])
        links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])

    jersey = bpy.data.materials.new(name="JerseyBlue")
    jersey.use_nodes = True
    jbsdf = jersey.node_tree.nodes.get('Principled BSDF')
    if jbsdf:
        jbsdf.inputs['Base Color'].default_value = (0.016, 0.11, 0.42, 1) # Team blue
        jbsdf.inputs['Roughness'].default_value = 0.7

    return skin, jersey

def create_single_rigged_hand(side_prefix, skin_mat, jersey_mat):
    """Creates one complete, rigged hand object."""
    x_mult = 1 if side_prefix == 'R' else -1
    parts = []
    
    bpy.ops.mesh.primitive_cube_add(location=(0, 0, 0)); palm = bpy.context.active_object
    palm.name = f"Palm.{side_prefix}"; palm.scale = (0.7, 1, 0.2); parts.append(palm)
    palm.data.materials.append(skin_mat)
    
    finger_mesh_data = [("Index", (-0.35, 0.85, 0), (0.18, 0.7, 0.18)), ("Middle", (-0.1, 0.9, 0), (0.2, 0.8, 0.2)), ("Ring", (0.15, 0.87, 0), (0.18, 0.75, 0.18)), ("Pinky", (0.4, 0.8, 0), (0.15, 0.6, 0.15))]
    for name, loc, scale in finger_mesh_data:
        bpy.ops.mesh.primitive_cube_add(location=(loc[0] * x_mult, loc[1], loc[2])); finger = bpy.context.active_object
        finger.name = f"{name}.{side_prefix}"; finger.scale = scale; parts.append(finger)
        
    bpy.ops.mesh.primitive_cube_add(location=(-0.6 * x_mult, 0.3, 0)); thumb = bpy.context.active_object
    thumb.name = f"Thumb.{side_prefix}"; thumb.scale = (0.2, 0.4, 0.2); parts.append(thumb)

    # Jersey sleeve cuff at the wrist (negative Y end of the palm)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.78, depth=0.7, location=(0, -1.3, 0), rotation=(math.pi / 2, 0, 0)); sleeve = bpy.context.active_object
    sleeve.name = f"Sleeve.{side_prefix}"; sleeve.scale = (1.0, 0.4, 1.0); parts.append(sleeve)
    sleeve.data.materials.append(jersey_mat)
    
    for part in parts:
        bpy.context.view_layer.objects.active = part
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        
    bpy.ops.object.armature_add(enter_editmode=True, align='WORLD', location=(0,0,0)); armature = bpy.context.active_object
    armature.name = f"Armature.{side_prefix}"; edit_bones = armature.data.edit_bones
    palm_bone = edit_bones.get('Bone'); palm_bone.name = "Palm"; palm_bone.head, palm_bone.tail = (0, -0.5, 0), (0, 0.5, 0)
    
    finger_bone_data = [("Index", (-0.35, 0.5, 0), 0.35), ("Middle", (-0.1, 0.5, 0), 0.4), ("Ring", (0.15, 0.5, 0), 0.38), ("Pinky", (0.4, 0.5, 0), 0.3)]
    for name, pos, length in finger_bone_data:
        bone1 = edit_bones.new(f'{name}1'); bone1.head, bone1.tail = (pos[0]*x_mult, pos[1], 0), (pos[0]*x_mult, pos[1] + length, 0); bone1.parent = palm_bone
        bone2 = edit_bones.new(f'{name}2'); bone2.head, bone2.tail = (pos[0]*x_mult, pos[1] + length, 0), (pos[0]*x_mult, pos[1] + length * 2, 0); bone2.parent = bone1
        
    thumb1 = edit_bones.new('Thumb1'); thumb1.head, thumb1.tail = ((-0.6*x_mult, 0.2, 0), (-0.8*x_mult, 0.6, 0)); thumb1.parent = palm_bone
    bpy.ops.object.mode_set(mode='OBJECT')
    
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = palm
    bpy.ops.object.join()
    hand_mesh = bpy.context.active_object
    hand_mesh.name = f"Hand_Mesh.{side_prefix}"

    bpy.ops.object.modifier_add(type='SUBSURF'); hand_mesh.modifiers["Subdivision"].levels = 2

    bpy.ops.object.select_all(action='DESELECT')
    hand_mesh.select_set(True)
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')

    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.object.empty_add(type='PLAIN_AXES', location=(0, 0, 0)); root = bpy.context.active_object
    root.name = f"Root.{side_prefix}"
    armature.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.object.parent_set(type='OBJECT', keep_transform=True)

    return root, armature, hand_mesh

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
    """Main function to create and export the hands model."""
    clear_scene()

    skin_material, jersey_material = build_materials()

    right_root, right_armature, right_mesh = create_single_rigged_hand('R', skin_material, jersey_material)
    left_root, left_armature, left_mesh = create_single_rigged_hand('L', skin_material, jersey_material)

    right_root.location.x = 0.09
    left_root.location.x = -0.09

    pose_open_r = {"Palm": (0, -75, -20), "Thumb1": (10, 45, -105), "Index1": (0, 0, -15), "Index2": (0,0,0), "Middle1": (0,0,0), "Middle2": (0,0,0), "Ring1": (0, 0, 15), "Ring2": (0,0,0), "Pinky1": (0, 0, 45), "Pinky2": (0, 0, -20)}
    pose_open_l = {"Palm": (0, 75, 20), "Thumb1": (10, -45, 105), "Index1": (0, 0, 15), "Index2": (0,0,0), "Middle1": (0,0,0), "Middle2": (0,0,0), "Ring1": (0, 0, -15), "Ring2": (0,0,0), "Pinky1": (0, 0, -45), "Pinky2": (0, 0, 20)}

    set_pose(right_armature, pose_open_r)
    set_pose(left_armature, pose_open_l)
    
    bpy.context.view_layer.update()
    bpy.context.scene.frame_set(1)

    filepath = "D:\\catch-game\\assets\\hands_model.glb"
    bpy.ops.export_scene.gltf(
        filepath=filepath,
        use_selection=False,
        export_apply=True,
        export_materials='EXPORT',
        export_animations=False, # No animations in this file
        export_rest_position_armature=False # Export the current pose
    )

    print(f"--- SCRIPT FINISHED ---\nExported to {filepath}")

main()
