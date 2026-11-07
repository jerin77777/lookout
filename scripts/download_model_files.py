import urllib.request
import urllib.parse
import re
import os
import zipfile
import io

def download_gdrive(file_id, dest_path):
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor())
    url = f"https://drive.google.com/uc?export=download&id={file_id}"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
    
    with opener.open(req) as resp:
        content = resp.read().decode('utf-8', errors='ignore')
        
    # Find form action and inputs
    form_action = re.search(r'action="([^"]+)"', content)
    action_url = form_action.group(1) if form_action else "https://drive.usercontent.google.com/download"
    
    # Extract all hidden inputs
    inputs = re.findall(r'<input type="hidden" name="([^"]+)" value="([^"]+)"', content)
    params = {name: val for name, val in inputs}
    params['id'] = file_id
    params['export'] = 'download'
    
    query_str = urllib.parse.urlencode(params)
    download_url = f"{action_url}?{query_str}"
    print(f"Downloading from: {download_url}")
    
    req2 = urllib.request.Request(download_url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
    with opener.open(req2) as resp:
        data = resp.read()
        
    print(f"Downloaded {len(data) / (1024*1024):.2f} MB.")
    if data.startswith(b'PK'):
        print("Extracting zip file...")
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            zf.extractall(dest_path)
        print("Extracted successfully!")
        return True
    else:
        print("Data is not a zip! First 300 chars:", data[:300])
        return False

if __name__ == "__main__":
    download_gdrive("1un9yAGlGjDooPwlnwFpJrbGHRiLaBNzV", "backend/ai/hybrik")
