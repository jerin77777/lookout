import argparse
import json
import os
import subprocess
import sys
import importlib.util

# Ensure current working directory is in sys.path for backend package imports
sys.path.insert(0, os.getcwd())

# Import Python config from arri.config.py
CONFIG = {}
config_py_path = os.path.join(os.getcwd(), "arri.config.py")
if os.path.exists(config_py_path):
    try:
        spec = importlib.util.spec_from_file_location("arri_config_mod", config_py_path)
        if spec and spec.loader:
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            CONFIG = getattr(mod, "CONFIG", {})
    except Exception as e:
        print(f"Warning: Could not load arri.config.py: {e}")

if not CONFIG:
    CONFIG = {
        "server": {"host": "0.0.0.0", "port": 5000, "output_definition": ".output/__definition.json"},
        "generators": [
            {"name": "typescript", "client_name": "ArriClient", "output_file": "yoga/src/services/arri_client.rpc.ts"},
            {"name": "dart", "client_name": "ArriClient", "output_file": "frontend_tv/lib/services/arri_client.rpc.dart"},
            {"name": "dart", "client_name": "ArriClient", "output_file": "frontend/lib/services/arri_client.rpc.dart"},
        ]
    }

def export_definition(output_path: str = None):
    if not output_path:
        output_path = CONFIG.get("server", {}).get("output_definition", ".output/__definition.json")
    from backend.main import arri_app
    app_def = arri_app.get_app_definition()
    print(f"EXPORTING {len(app_def['procedures'])} PROCEDURES:", list(app_def["procedures"].keys()))
    dir_path = os.path.dirname(os.path.abspath(output_path))
    if dir_path and not os.path.exists(dir_path):
        os.makedirs(dir_path, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(app_def, f, indent=2)
    print(f"Exported Arri App Definition to {output_path}")

def run_codegen():
    def_path = CONFIG.get("server", {}).get("output_definition", ".output/__definition.json")
    export_definition(def_path)
    
    generators_config = CONFIG.get("generators", [])
    gen_json = json.dumps(generators_config)
    
    runner_script = os.path.join(os.getcwd(), "scripts", "codegen_runner.mjs")
    cmd = ["node", runner_script, gen_json]
    subprocess.run(cmd, check=False)

def run_dev():
    def_path = CONFIG.get("server", {}).get("output_definition", ".output/__definition.json")
    export_definition(def_path)
    run_codegen()
    
    host = CONFIG.get("server", {}).get("host", "0.0.0.0")
    port = CONFIG.get("server", {}).get("port", 5000)
    print(f"Starting Python Arri Backend Server on http://{host}:{port}...")
    import uvicorn
    uvicorn.run(
        "backend.main:app",
        host=host,
        port=port,
        reload=True,
        reload_dirs=["backend"],
        reload_includes=["*.py"],
        reload_excludes=["*.pyc", "__pycache__", ".output", "uploads", ".git"]
    )

def ensure_nginx_started():
    try:
        import subprocess
        # Check tasklist for nginx.exe on Windows
        tasklist_output = subprocess.check_output('tasklist /FI "IMAGENAME eq nginx.exe"', shell=True, text=True)
        if "nginx.exe" not in tasklist_output:
            print("Nginx is not running. Starting Nginx...", flush=True)
            nginx_dir = os.path.abspath(os.path.join(os.getcwd(), "nginx"))
            nginx_exe = os.path.join(nginx_dir, "nginx.exe")
            if os.path.exists(nginx_exe):
                # Start nginx in the nginx directory
                subprocess.Popen([nginx_exe], cwd=nginx_dir, shell=True)
                print("Nginx started successfully.", flush=True)
            else:
                pass # Nginx optional; FastAPI directly serves requests
        else:
            print("Nginx is already running.", flush=True)
    except Exception as e:
        print(f"Warning: Failed to check/start Nginx: {e}", flush=True)

def main():
    ensure_nginx_started()
    parser = argparse.ArgumentParser(description="Arri Python CLI")
    parser.add_argument("command", choices=["dev", "build", "codegen", "export-def"], nargs="?", default="dev")
    args = parser.parse_args()

    if args.command == "export-def":
        export_definition()
    elif args.command == "codegen":
        run_codegen()
    elif args.command == "build":
        export_definition()
        run_codegen()
    elif args.command == "dev":
        run_dev()

if __name__ == "__main__":
    main()
