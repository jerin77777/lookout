import struct
import json
import os
import io
import subprocess
from PIL import Image

def optimize_and_compress_amber(
    input_path='yoga/public/amber.glb',
    output_path='yoga/public/amber.glb',
    backup_path='yoga/public/amber_backup.glb',
    max_dim=1024,
    webp_quality=78,
    normal_quality=85
):
    print(f"=== Starting Amber Model Compression ===")
    print(f"Source file: {input_path} ({os.path.getsize(input_path) / (1024*1024):.2f} MB)")

    # 1. Create a safe backup if not already present or if input is original
    if not os.path.exists(backup_path) or os.path.getsize(backup_path) < 50 * 1024 * 1024:
        if os.path.getsize(input_path) > 70 * 1024 * 1024:
            print(f"Creating backup at {backup_path}...")
            with open(input_path, 'rb') as src_f, open(backup_path, 'wb') as dst_f:
                dst_f.write(src_f.read())

    # 2. Read GLB
    with open(input_path, 'rb') as f:
        magic, version, total_len = struct.unpack('<4sII', f.read(12))
        
        # Read JSON chunk
        json_len, json_type = struct.unpack('<I4s', f.read(8))
        json_data = json.loads(f.read(json_len).decode('utf-8'))
        
        # Read BIN chunk
        bin_len, bin_type = struct.unpack('<I4s', f.read(8))
        bin_data = f.read(bin_len)

    # 3. Compress textures with Pillow to clean WebP
    images_raw_data = {}
    total_orig_img_bytes = 0
    total_new_img_bytes = 0
    
    print(f"Optimizing {len(json_data.get('images', []))} embedded textures...")
    for img_idx, img in enumerate(json_data.get('images', [])):
        if 'bufferView' in img:
            bv = json_data['bufferViews'][img['bufferView']]
            offset = bv.get('byteOffset', 0)
            length = bv['byteLength']
            img_bytes = bin_data[offset:offset + length]
            total_orig_img_bytes += length
            
            img_name = img.get('name', f'img_{img_idx}')
            try:
                pil_img = Image.open(io.BytesIO(img_bytes))
                orig_w, orig_h = pil_img.size
                
                # Sizing tailored for high visual fidelity and low memory
                if 'Head' in img_name or 'Face' in img_name or 'Skin_Body' in img_name or 'Hair' in img_name or 'Shirt' in img_name or 'Jeans' in img_name:
                    limit = 1024
                elif 'Tearline' in img_name or 'Occlusion' in img_name:
                    limit = 128
                else:
                    limit = 512
                    
                if orig_w > limit or orig_h > limit:
                    pil_img.thumbnail((limit, limit), Image.Resampling.LANCZOS)
                
                out_io = io.BytesIO()
                has_alpha = pil_img.mode in ('RGBA', 'LA') or (pil_img.mode == 'P' and 'transparency' in pil_img.info)
                
                is_normal = 'normal' in img_name.lower()
                q = normal_quality if is_normal else webp_quality
                
                if has_alpha:
                    pil_img.save(out_io, format='WEBP', quality=q, method=6)
                else:
                    pil_img = pil_img.convert('RGB')
                    pil_img.save(out_io, format='WEBP', quality=q, method=6)
                
                compressed = out_io.getvalue()
                # Use compressed WebP
                if len(compressed) < len(img_bytes) or img.get('mimeType') != 'image/webp':
                    img_bytes = compressed
                    img['mimeType'] = 'image/webp'
                
            except Exception as e:
                print(f"Warning: Skipping image {img_name}: {e}")
                
            total_new_img_bytes += len(img_bytes)
            images_raw_data[img_idx] = img_bytes

    print(f"Textures optimized: {total_orig_img_bytes/(1024*1024):.2f} MB -> {total_new_img_bytes/(1024*1024):.2f} MB")

    # Add EXT_texture_webp extension
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

    # Serialize intermediate WebP GLB
    abs_output = os.path.abspath(output_path)
    temp_webp_path = abs_output.replace('.glb', '_temp_webp.glb')
    temp_draco_path = abs_output.replace('.glb', '_temp_draco.glb')

    new_json_bytes = json.dumps(json_data, separators=(',', ':')).encode('utf-8')
    pad_json = (4 - (len(new_json_bytes) % 4)) % 4
    new_json_bytes += b' ' * pad_json

    pad_bin = (4 - (len(new_bin_data) % 4)) % 4
    new_bin_data.extend(b'\x00' * pad_bin)

    header = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(new_json_bytes) + 8 + len(new_bin_data))
    chunk0_hdr = struct.pack('<I4s', len(new_json_bytes), b'JSON')
    chunk1_hdr = struct.pack('<I4s', len(new_bin_data), b'BIN\x00')

    with open(temp_webp_path, 'wb') as f:
        f.write(header)
        f.write(chunk0_hdr)
        f.write(new_json_bytes)
        f.write(chunk1_hdr)
        f.write(new_bin_data)

    print(f"Intermediate WebP GLB created: {temp_webp_path} ({os.path.getsize(temp_webp_path)/(1024*1024):.2f} MB)")

    # 4. Run Draco geometry compression using gltf-transform
    print("Applying Draco mesh compression via gltf-transform...")
    cmd_str = f'npx -y @gltf-transform/cli draco "{temp_webp_path}" "{temp_draco_path}"'
    res = subprocess.run(cmd_str, shell=True, capture_output=True, text=True)
    if res.returncode != 0:
        print("Draco CLI error:", res.stderr)
        raise RuntimeError(f"Draco compression failed: {res.stderr}")

    print(f"Draco compression output: {res.stdout.strip()}")
    if not os.path.exists(temp_draco_path):
        raise FileNotFoundError(f"Expected Draco output not found at: {temp_draco_path}")

    print(f"Draco compression completed: {os.path.getsize(temp_draco_path)/(1024*1024):.2f} MB")

    # 5. Overwrite destination safely
    import shutil
    if os.path.exists(abs_output):
        os.remove(abs_output)
    shutil.move(temp_draco_path, abs_output)

    # Clean up temp webp
    if os.path.exists(temp_webp_path):
        os.remove(temp_webp_path)

    final_size_mb = os.path.getsize(abs_output) / (1024 * 1024)
    print(f"=== Compression Completed Successfully! ===")
    print(f"Final Model: {abs_output} ({final_size_mb:.2f} MB)")
    return final_size_mb

if __name__ == '__main__':
    import shutil
    # Compress yoga/public/amber.glb
    final_size = optimize_and_compress_amber(
        input_path='yoga/public/amber_backup.glb' if os.path.exists('yoga/public/amber_backup.glb') else 'yoga/public/amber.glb',
        output_path='yoga/public/amber.glb',
        backup_path='yoga/public/amber_backup.glb'
    )
    # Synchronize to all asset locations
    for target in ['yoga/assets/amber.glb', 'yoga/assets/amber_optimized.glb', 'yoga/public/amber_optimized.glb']:
        shutil.copyfile('yoga/public/amber.glb', target)
        print(f"Synchronized to {target} ({final_size:.2f} MB)")

