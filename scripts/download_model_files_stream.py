import urllib.request
import urllib.parse
import re
import os
import zipfile
import sys

def download_and_extract_stream(file_id, output_zip_path, extract_dir):
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor())
    url = f"https://drive.google.com/uc?export=download&id={file_id}"
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
    
    print(f"Connecting to Google Drive file: {file_id}...")
    req = urllib.request.Request(url, headers=headers)
    with opener.open(req) as resp:
        content = resp.read().decode('utf-8', errors='ignore')
        
    form_action = re.search(r'action="([^"]+)"', content)
    action_url = form_action.group(1) if form_action else "https://drive.usercontent.google.com/download"
    
    inputs = re.findall(r'<input type="hidden" name="([^"]+)" value="([^"]+)"', content)
    params = {name: val for name, val in inputs}
    params['id'] = file_id
    params['export'] = 'download'
    
    query_str = urllib.parse.urlencode(params)
    download_url = f"{action_url}?{query_str}"
    
    print(f"Streaming download to {output_zip_path}...")
    req2 = urllib.request.Request(download_url, headers=headers)
    
    with opener.open(req2) as resp:
        total_size = int(resp.headers.get('Content-Length', 0))
        downloaded = 0
        chunk_size = 1024 * 1024  # 1 MB
        
        with open(output_zip_path, 'wb') as out_f:
            while True:
                chunk = resp.read(chunk_size)
                if not chunk:
                    break
                out_f.write(chunk)
                downloaded += len(chunk)
                if total_size > 0:
                    pct = (downloaded / total_size) * 100
                    sys.stdout.write(f"\rDownloading: {downloaded / (1024*1024):.1f} MB / {total_size / (1024*1024):.1f} MB ({pct:.1f}%)")
                else:
                    sys.stdout.write(f"\rDownloading: {downloaded / (1024*1024):.1f} MB")
                sys.stdout.flush()
                
    print("\nDownload complete! Extracting archive...")
    with zipfile.ZipFile(output_zip_path, 'r') as zf:
        zf.extractall(extract_dir)
    print("Extraction complete!")
    
    # Clean up zip
    if os.path.exists(output_zip_path):
        os.remove(output_zip_path)
    print("Cleaned up temporary archive.")

if __name__ == "__main__":
    download_and_extract_stream("1un9yAGlGjDooPwlnwFpJrbGHRiLaBNzV", "backend/ai/hybrik/model_files.zip", "backend/ai/hybrik")
