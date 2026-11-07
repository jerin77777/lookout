import struct
import json

with open('yoga/assets/amber.glb', 'rb') as f:
    f.read(12)
    chunk_len, chunk_type = struct.unpack('<I4s', f.read(8))
    data = json.loads(f.read(chunk_len).decode('utf-8'))

print(f"Total buffer views count: {len(data.get('bufferViews', []))}")
print(f"Total accessors count: {len(data.get('accessors', []))}")

# Check morph targets / targets in meshes
morph_targets_count = 0
for mesh in data.get('meshes', []):
    for prim in mesh.get('primitives', []):
        targets = prim.get('targets', [])
        morph_targets_count += len(targets)
print(f"Total Morph targets in primitives: {morph_targets_count}")

# Check animations
for anim in data.get('animations', []):
    print(f"Animation: {anim.get('name')}, channels: {len(anim.get('channels', []))}, samplers: {len(anim.get('samplers', []))}")
