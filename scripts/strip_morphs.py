import struct
import json
import os
import io

try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

def optimize_glb(src_path, dst_path, compress_textures=True, max_tex_dim=2048):
    with open(src_path, 'rb') as f:
        magic, version, total_len = struct.unpack('<4sII', f.read(12))
        
        # Read JSON chunk
        json_len, json_type = struct.unpack('<I4s', f.read(8))
        json_data = json.loads(f.read(json_len).decode('utf-8'))
        
        # Read BIN chunk
        bin_len, bin_type = struct.unpack('<I4s', f.read(8))
        bin_data = f.read(bin_len)

    print(f"Original GLB: {os.path.getsize(src_path) / (1024*1024):.2f} MB")
    
    # 1. Remove morph targets from meshes
    for mesh in json_data.get('meshes', []):
        for prim in mesh.get('primitives', []):
            if 'targets' in prim:
                del prim['targets']
        if 'weights' in mesh:
            del mesh['weights']

    # 2. Remove animations completely
    if 'animations' in json_data:
        print(f"Removing {len(json_data['animations'])} animations...")
        del json_data['animations']

    # 3. Process and optionally compress/resize textures
    images_raw_data = {}
    for img_idx, img in enumerate(json_data.get('images', [])):
        if 'bufferView' in img:
            bv = json_data['bufferViews'][img['bufferView']]
            offset = bv.get('byteOffset', 0)
            length = bv['byteLength']
            img_bytes = bin_data[offset:offset + length]
            
            if compress_textures and PIL_AVAILABLE:
                try:
                    pil_img = Image.open(io.BytesIO(img_bytes))
                    orig_format = pil_img.format
                    orig_size = pil_img.size
                    
                    # Resize if larger than max_tex_dim
                    if orig_size[0] > max_tex_dim or orig_size[1] > max_tex_dim:
                        pil_img.thumbnail((max_tex_dim, max_tex_dim), Image.Resampling.LANCZOS)
                    
                    out_io = io.BytesIO()
                    # If image has alpha transparency, save as optimized PNG or WebP
                    has_alpha = pil_img.mode in ('RGBA', 'LA') or (pil_img.mode == 'P' and 'transparency' in pil_img.info)
                    
                    # Compress
                    if has_alpha:
                        # Convert to optimized PNG or WebP
                        pil_img.save(out_io, format='PNG', optimize=True)
                        img['mimeType'] = 'image/png'
                    else:
                        pil_img = pil_img.convert('RGB')
                        pil_img.save(out_io, format='JPEG', quality=85, optimize=True)
                        img['mimeType'] = 'image/jpeg'
                    
                    compressed_bytes = out_io.getvalue()
                    # Only use if smaller
                    if len(compressed_bytes) < len(img_bytes):
                        img_bytes = compressed_bytes
                except Exception as e:
                    print(f"Error compressing image {img.get('name', img_idx)}: {e}")
                    
            images_raw_data[img_idx] = img_bytes

    # 4. Identify all remaining used accessors
    used_accessors = set()
    for mesh in json_data.get('meshes', []):
        for prim in mesh.get('primitives', []):
            if 'indices' in prim:
                used_accessors.add(prim['indices'])
            for acc in prim.get('attributes', {}).values():
                used_accessors.add(acc)
    
    for skin in json_data.get('skins', []):
        if 'inverseBindMatrices' in skin:
            used_accessors.add(skin['inverseBindMatrices'])

    used_bv_indices = set()
    for acc_idx in used_accessors:
        if acc_idx < len(json_data['accessors']):
            acc = json_data['accessors'][acc_idx]
            if 'bufferView' in acc:
                used_bv_indices.add(acc['bufferView'])

    # 5. Rebuild binary buffer
    new_bin_data = bytearray()
    bv_map = {}
    new_buffer_views = []

    # Pack geometry buffer views
    for old_idx in sorted(list(used_bv_indices)):
        bv = json_data['bufferViews'][old_idx]
        byte_offset = bv.get('byteOffset', 0)
        byte_len = bv['byteLength']
        slice_data = bin_data[byte_offset:byte_offset + byte_len]
        
        pad = (4 - (len(new_bin_data) % 4)) % 4
        if pad > 0:
            new_bin_data.extend(b'\x00' * pad)
            
        new_byte_offset = len(new_bin_data)
        new_bin_data.extend(slice_data)
        
        new_bv = dict(bv)
        new_bv['byteOffset'] = new_byte_offset
        new_bv['buffer'] = 0
        new_buffer_views.append(new_bv)
        bv_map[old_idx] = len(new_buffer_views) - 1

    # Pack image buffer views
    for img_idx, img in enumerate(json_data.get('images', [])):
        img_bytes = images_raw_data[img_idx]
        pad = (4 - (len(new_bin_data) % 4)) % 4
        if pad > 0:
            new_bin_data.extend(b'\x00' * pad)
            
        new_byte_offset = len(new_bin_data)
        new_bin_data.extend(img_bytes)
        
        img_bv = {
            'buffer': 0,
            'byteOffset': new_byte_offset,
            'byteLength': len(img_bytes)
        }
        new_buffer_views.append(img_bv)
        img['bufferView'] = len(new_buffer_views) - 1

    # Remap accessors
    acc_map = {}
    new_accessors = []
    for old_idx, acc in enumerate(json_data.get('accessors', [])):
        if old_idx in used_accessors:
            new_acc = dict(acc)
            if 'bufferView' in new_acc:
                new_acc['bufferView'] = bv_map[new_acc['bufferView']]
            new_accessors.append(new_acc)
            acc_map[old_idx] = len(new_accessors) - 1

    # Update primitive references
    for mesh in json_data.get('meshes', []):
        for prim in mesh.get('primitives', []):
            if 'indices' in prim:
                prim['indices'] = acc_map[prim['indices']]
            for k, acc_idx in prim.get('attributes', {}).items():
                prim['attributes'][k] = acc_map[acc_idx]

    # Update skin references
    for skin in json_data.get('skins', []):
        if 'inverseBindMatrices' in skin:
            skin['inverseBindMatrices'] = acc_map[skin['inverseBindMatrices']]

    json_data['accessors'] = new_accessors
    json_data['bufferViews'] = new_buffer_views
    json_data['buffers'] = [{'byteLength': len(new_bin_data)}]

    # Serialize GLB
    new_json_bytes = json.dumps(json_data, separators=(',', ':')).encode('utf-8')
    pad_json = (4 - (len(new_json_bytes) % 4)) % 4
    new_json_bytes += b' ' * pad_json

    pad_bin = (4 - (len(new_bin_data) % 4)) % 4
    new_bin_data.extend(b'\x00' * pad_bin)

    header = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(new_json_bytes) + 8 + len(new_bin_data))
    chunk0_hdr = struct.pack('<I4s', len(new_json_bytes), b'JSON')
    chunk1_hdr = struct.pack('<I4s', len(new_bin_data), b'BIN\x00')

    with open(dst_path, 'wb') as f:
        f.write(header)
        f.write(chunk0_hdr)
        f.write(new_json_bytes)
        f.write(chunk1_hdr)
        f.write(new_bin_data)

    print(f"Successfully created: {dst_path}")
    print(f"Final Optimized Size: {os.path.getsize(dst_path) / (1024*1024):.2f} MB")

if __name__ == '__main__':
    optimize_glb('yoga/assets/amber.glb', 'yoga/assets/amber_optimized.glb')
