import struct
import json

with open('yoga/assets/amber.glb', 'rb') as f:
    f.read(12)
    chunk_len, chunk_type = struct.unpack('<I4s', f.read(8))
    data = json.loads(f.read(chunk_len).decode('utf-8'))
    
img_total = 0
for img in data.get('images', []):
    bv = data['bufferViews'][img['bufferView']]
    img_total += bv['byteLength']
print(f"Total Image/Texture Bytes: {img_total / (1024*1024):.2f} MB")

total_bv = sum(bv['byteLength'] for bv in data.get('bufferViews', []))
print(f"Total BufferViews: {total_bv / (1024*1024):.2f} MB")
print(f"Geometry and other: {(total_bv - img_total) / (1024*1024):.2f} MB")

bvs = sorted(enumerate(data.get('bufferViews', [])), key=lambda x: x[1]['byteLength'], reverse=True)
for i, bv in bvs[:20]:
    img_name = next((img.get('name', 'unnamed') for img in data.get('images', []) if img.get('bufferView') == i), 'GEOMETRY/ANIM/MORPH')
    print(f"BV {i}: {bv['byteLength'] / (1024*1024):.2f} MB - {img_name}")
