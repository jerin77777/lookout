import os
import re
import sys
import shutil
import logging
import subprocess
from urllib.parse import urlparse

logger = logging.getLogger("NginxService")

def get_project_root() -> str:
    """Returns absolute path to the project root directory."""
    # backend/services/nginx_service.py -> backend/services -> backend -> lookout (root)
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

def get_file_server_config():
    """
    Retrieves the file server base directory location and URL path from environment variables.
    Defaults to <project_root>/uploads and /uploads/.
    """
    project_root = get_project_root()
    
    # 1. Base file location (disk path)
    raw_location = (
        os.getenv("FILE_LOCATION")
        or os.getenv("FILE_SERVER_LOCATION")
        or os.getenv("FILE_SERVER_PATH")
        or os.path.join(project_root, "uploads")
    )
    
    if not os.path.isabs(raw_location):
        raw_location = os.path.join(project_root, raw_location)
    
    abs_location = os.path.abspath(raw_location)
    os.makedirs(abs_location, exist_ok=True)
    
    # Nginx requires forward slashes, even on Windows
    nginx_file_path = abs_location.replace("\\", "/").rstrip("/") + "/"

    # 2. File server URL path
    raw_url = os.getenv("FILE_SERVER_URL") or "/uploads"
    if "://" in raw_url:
        parsed = urlparse(raw_url)
        url_path = parsed.path or "/uploads"
    else:
        url_path = raw_url

    url_path = "/" + url_path.strip("/") + "/"
    # Clean multiple consecutive slashes
    url_path = re.sub(r"/+", "/", url_path)

    return abs_location, nginx_file_path, url_path

def generate_location_block(url_path: str, nginx_file_path: str) -> str:
    """Generates the Nginx location block for the file server."""
    return f"""        # === FILE_SERVER_BASE_LOCATION_START ===
        # Auto-configured file server base location: {url_path} -> {nginx_file_path}
        location {url_path} {{
            alias {nginx_file_path};
            add_header Access-Control-Allow-Origin * always;
            add_header Access-Control-Allow-Methods 'GET, OPTIONS, HEAD' always;
            add_header Access-Control-Allow-Headers 'Range,Content-Type,Authorization' always;
            autoindex off;
            sendfile on;
            tcp_nopush on;
            tcp_nodelay on;
            expires 30d;
        }}
        # === FILE_SERVER_BASE_LOCATION_END ==="""

def update_nginx_conf(nginx_conf_path: str = None) -> bool:
    """
    Updates the Nginx configuration file with the base file server location and URL.
    """
    project_root = get_project_root()
    if not nginx_conf_path:
        nginx_conf_path = os.path.join(project_root, "nginx", "conf", "nginx.conf")

    if not os.path.exists(nginx_conf_path):
        logger.warning(f"Nginx config not found at: {nginx_conf_path}")
        return False

    abs_location, nginx_file_path, url_path = get_file_server_config()
    logger.info(f"Configuring Nginx file server: URL='{url_path}' -> Path='{nginx_file_path}'")

    try:
        with open(nginx_conf_path, "r", encoding="utf-8") as f:
            content = f.read()

        location_block = generate_location_block(url_path, nginx_file_path)

        # 1. Update any obsolete hardcoded Administrator paths from template
        backend_dir = os.path.join(project_root, "backend").replace("\\", "/")
        yoga_dist_dir = os.path.join(project_root, "yoga", "dist").replace("\\", "/")
        content = content.replace("C:/Users/Administrator/Music/appforge/backend", backend_dir)
        content = content.replace("C:/Users/Administrator/Music/vyom/yoga/dist", yoga_dist_dir)

        # 2. Check if the tagged file server block already exists
        marker_pattern = r"[ \t]*# === FILE_SERVER_BASE_LOCATION_START ===.*?# === FILE_SERVER_BASE_LOCATION_END ==="
        if re.search(marker_pattern, content, flags=re.DOTALL):
            content = re.sub(marker_pattern, location_block.strip(), content, flags=re.DOTALL)
        else:
            # Insert into server block listening on 9090 (Backend API & SSL)
            # Find the closing brace of the server block for 9090
            server_9090_match = re.search(r"(server\s*\{[^}]*listen\s+9090\s+ssl;.*?)(\n\s*\})", content, flags=re.DOTALL)
            if server_9090_match:
                server_body = server_9090_match.group(1)
                server_close = server_9090_match.group(2)
                updated_server = f"{server_body}\n\n{location_block}{server_close}"
                content = content[:server_9090_match.start()] + updated_server + content[server_9090_match.end():]
            else:
                # Fallback: insert before the last closing brace of http block
                last_brace = content.rfind("}")
                if last_brace != -1:
                    content = content[:last_brace] + f"\n{location_block}\n" + content[last_brace:]

        with open(nginx_conf_path, "w", encoding="utf-8") as f:
            f.write(content)

        logger.info(f"Successfully updated Nginx configuration at {nginx_conf_path}")
        return True
    except Exception as e:
        logger.error(f"Failed to update Nginx configuration: {e}")
        return False

def is_nginx_running() -> bool:
    """Checks whether nginx process is currently active."""
    try:
        if sys.platform == "win32":
            res = subprocess.run(
                ["powershell", "-NoProfile", "-Command", "Get-Process -Name nginx -ErrorAction SilentlyContinue"],
                capture_output=True,
                text=True,
                timeout=5
            )
            return "nginx" in res.stdout.lower()
        else:
            res = subprocess.run(["pgrep", "nginx"], capture_output=True, timeout=5)
            return res.returncode == 0
    except Exception:
        return False

def ensure_nginx_started():
    """
    Configures Nginx with the environment file server URL and starts or reloads Nginx.
    """
    # 1. Update config first
    update_nginx_conf()

    project_root = get_project_root()
    nginx_dir = os.path.join(project_root, "nginx")
    nginx_exe = os.path.join(nginx_dir, "nginx.exe") if sys.platform == "win32" else shutil.which("nginx")

    try:
        running = is_nginx_running()
        if running:
            logger.info("Nginx is running. Reloading configuration...")
            if os.path.exists(nginx_exe):
                subprocess.run([nginx_exe, "-s", "reload"], cwd=nginx_dir, capture_output=True, timeout=5)
            elif shutil.which("nginx"):
                subprocess.run(["nginx", "-s", "reload"], cwd=nginx_dir, capture_output=True, timeout=5)
            logger.info("Nginx configuration reloaded.")
        else:
            if os.path.exists(nginx_exe):
                logger.info("Starting Nginx...")
                subprocess.Popen([nginx_exe], cwd=nginx_dir, shell=True)
                logger.info("Nginx started successfully.")
            elif shutil.which("nginx"):
                logger.info("Starting system Nginx...")
                subprocess.Popen(["nginx"], cwd=nginx_dir, shell=True)
                logger.info("Nginx started successfully.")
            else:
                logger.info("Nginx executable not found in workspace or PATH. Nginx config updated; FastAPI will handle file serving directly.")
    except Exception as e:
        logger.warning(f"Nginx startup/reload check encountered an issue: {e}")

