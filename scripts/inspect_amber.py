import struct
import json
import os

paths = [
    'yoga/public/amber.glb',
    'yoga/public/amber_backup.glb',
    'yoga/public/amber_compressed.glb',
    'yoga/public/amber_draco.glb',
    'yoga/public/amber_draco_clean.glb',
    'yoga/public/amber_optimized.glb',
    'yoga/assets/amber.glb',
    'yoga/assets/amber_optimized.glb'
]

for path in paths:
    if os.path.exists(path):
        size = os.path.getsize(path) / (1024 * 1024)
        print(f"=== {path} ({size:.2f} MB) ===")
        with open(path, 'rb') as f:
            f.read(12)
            chunk_len, chunk_type = struct.unpack('<I4s', f.read(8))
            data = json.loads(f.read(chunk_len).decode('utf-8'))
            
            img_total = 0
            for img in data.get('images', []):
                if 'bufferView' in img:
                    bv = data['bufferViews'][img['bufferView']]
                    img_total += bv['byteLength']
                    
            total_bv = sum(bv['byteLength'] for bv in data.get('bufferViews', []))
            print(f"  Images: {img_total / (1024 * 1024):.2f} MB ({len(data.get('images', []))} images)")
            print(f"  Geometry/buffers: {(total_bv - img_total) / (1024 * 1024):.2f} MB")
            print(f"  Meshes: {len(data.get('meshes', []))}, Primitives: {sum(len(m.get('primitives', [])) for m in data.get('meshes', []))}")
            print(f"  Extensions: {data.get('extensionsUsed', [])}")
            print(f"  ExtensionsRequired: {data.get('extensionsRequired', [])}")
            print(f"  Animations: {len(data.get('animations', []))}")
            print()
