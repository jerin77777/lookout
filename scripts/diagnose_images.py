import struct
import json
import io
import os
from PIL import Image

with open('yoga/public/amber.glb', 'rb') as f:
    f.read(12)
    j_len, _ = struct.unpack('<I4s', f.read(8))
    data = json.loads(f.read(j_len).decode('utf-8'))
    b_len, _ = struct.unpack('<I4s', f.read(8))
    bin_data = f.read(b_len)

print(f"Total images: {len(data.get('images', []))}")
for idx, img in enumerate(data.get('images', [])):
    bv = data['bufferViews'][img['bufferView']]
    offset = bv.get('byteOffset', 0)
    length = bv['byteLength']
    chunk = bin_data[offset:offset+length]
    name = img.get('name', f'img_{idx}')
    try:
        im = Image.open(io.BytesIO(chunk))
        im.load()
        print(f"Img {idx} ({name}): format={im.format}, size={im.size}, mode={im.mode}, bytes={length}")
    except Exception as e:
        print(f"Img {idx} ({name}): ERROR {e}, bytes={length}")
