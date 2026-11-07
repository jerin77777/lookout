import struct
import json
import os
import io
from PIL import Image

def optimize_textures_in_glb(src_path, dst_path, max_dim=2048, webp_quality=88):
    print(f"Reading {src_path} ({os.path.getsize(src_path)/(1024*1024):.2f} MB)...")
    with open(src_path, 'rb') as f:
        magic, version, total_len = struct.unpack('<4sII', f.read(12))
        
        # Read JSON chunk
        json_len, json_type = struct.unpack('<I4s', f.read(8))
        json_data = json.loads(f.read(json_len).decode('utf-8'))
        
        # Read BIN chunk
        bin_len, bin_type = struct.unpack('<I4s', f.read(8))
        bin_data = f.read(bin_len)

    # Compress / optimize all images
    images_raw_data = {}
    total_orig_img_bytes = 0
    total_new_img_bytes = 0
    
    for img_idx, img in enumerate(json_data.get('images', [])):
        if 'bufferView' in img:
            bv = json_data['bufferViews'][img['bufferView']]
            offset = bv.get('byteOffset', 0)
            length = bv['byteLength']
            img_bytes = bin_data[offset:offset + length]
            total_orig_img_bytes += length
            
            try:
                pil_img = Image.open(io.BytesIO(img_bytes))
                orig_w, orig_h = pil_img.size
                
                # Resize if larger than max_dim
                if orig_w > max_dim or orig_h > max_dim:
                    pil_img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
                
                out_io = io.BytesIO()
                has_alpha = pil_img.mode in ('RGBA', 'LA') or (pil_img.mode == 'P' and 'transparency' in pil_img.info)
                
                # Save as high-quality WebP
                if has_alpha:
                    pil_img.save(out_io, format='WEBP', quality=webp_quality, method=6)
                else:
                    pil_img = pil_img.convert('RGB')
                    pil_img.save(out_io, format='WEBP', quality=webp_quality, method=6)
                
                compressed = out_io.getvalue()
                # If WebP is smaller, use WebP and set mimeType
                if len(compressed) < len(img_bytes):
                    img_bytes = compressed
                    img['mimeType'] = 'image/webp'
                
            except Exception as e:
                print(f"Skipping image {img.get('name', img_idx)}: {e}")
                
            total_new_img_bytes += len(img_bytes)
            images_raw_data[img_idx] = img_bytes

    print(f"Texture compression: {total_orig_img_bytes/(1024*1024):.2f} MB -> {total_new_img_bytes/(1024*1024):.2f} MB")

    # Add EXT_texture_webp to extensionsUsed if any WebP images are present
    has_webp = any(img.get('mimeType') == 'image/webp' for img in json_data.get('images', []))
    if has_webp:
        ext_used = json_data.setdefault('extensionsUsed', [])
        if 'EXT_texture_webp' not in ext_used:
            ext_used.append('EXT_texture_webp')

    # Identify all used accessors
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

    # Rebuild binary buffer
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
    new_accessors = []
    for old_idx, acc in enumerate(json_data.get('accessors', [])):
        if old_idx in used_accessors:
            new_acc = dict(acc)
            if 'bufferView' in new_acc:
                new_acc['bufferView'] = bv_map[new_acc['bufferView']]
            new_accessors.append(new_acc)
            acc_map_val = len(new_accessors) - 1
        else:
            acc_map_val = None

    # Re-map primitive attributes and skins
    acc_map = {}
    new_accs = []
    for old_idx, acc in enumerate(json_data.get('accessors', [])):
        if old_idx in used_accessors:
            new_acc = dict(acc)
            if 'bufferView' in new_acc:
                new_acc['bufferView'] = bv_map[new_acc['bufferView']]
            new_accs.append(new_acc)
            acc_map[old_idx] = len(new_accs) - 1

    for mesh in json_data.get('meshes', []):
        for prim in mesh.get('primitives', []):
            if 'indices' in prim:
                prim['indices'] = acc_map[prim['indices']]
            for k, acc_idx in prim.get('attributes', {}).items():
                prim['attributes'][k] = acc_map[acc_idx]

    for skin in json_data.get('skins', []):
        if 'inverseBindMatrices' in skin:
            skin['inverseBindMatrices'] = acc_map[skin['inverseBindMatrices']]

    json_data['accessors'] = new_accs
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

    print(f"Created: {dst_path} ({os.path.getsize(dst_path)/(1024*1024):.2f} MB)")

if __name__ == '__main__':
    optimize_textures_in_glb('yoga/public/amber.glb', 'yoga/public/amber_optimized.glb')
