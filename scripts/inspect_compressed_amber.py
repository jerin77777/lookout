import struct
import json
import os

path = 'yoga/public/amber_compressed.glb'
with open(path, 'rb') as f:
    f.read(12)
    j_len, _ = struct.unpack('<I4s', f.read(8))
    data = json.loads(f.read(j_len).decode('utf-8'))
    b_len, _ = struct.unpack('<I4s', f.read(8))
    bin_data = f.read(b_len)

print('Compressed GLB size:', os.path.getsize(path)/(1024*1024), 'MB')
print('Images count:', len(data.get('images', [])))
img_total = 0
for idx, img in enumerate(data.get('images', [])):
    bv = data['bufferViews'][img['bufferView']]
    img_total += bv['byteLength']
    if idx < 5:
        print(f"Img {idx}: {img.get('name')} mime={img.get('mimeType')} bytes={bv['byteLength']}")
print(f"Total Image bytes: {img_total/(1024*1024):.2f} MB")
print('Draco extensions in meshes:')
for i, m in enumerate(data.get('meshes', [])):
    for p in m.get('primitives', []):
        if 'KHR_draco_mesh_compression' in p.get('extensions', {}):
            print(f" Mesh {i} prim has Draco: {p['extensions']['KHR_draco_mesh_compression']}")
            break
