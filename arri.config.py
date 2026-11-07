"""
Arri RPC Python Configuration File
Define backend server options and frontend client generators natively in Python.
"""

from typing import Dict, Any

CONFIG: Dict[str, Any] = {
    "server": {
        "title": "Vyom Python Backend",
        "version": "1.0.0",
        "host": "0.0.0.0",
        "port": 5000,
        "reload": True,
        "output_definition": ".output/__definition.json",
    },
    "generators": [
        {
            "name": "typescript",
            "client_name": "ArriClient",
            "output_file": "yoga/src/services/arri_client.rpc.ts",
        },
        {
            "name": "dart",
            "client_name": "ArriClient",
            "output_file": "frontend_tv/lib/services/arri_client.rpc.dart",
        },
        {
            "name": "dart",
            "client_name": "ArriClient",
            "output_file": "frontend/lib/services/arri_client.rpc.dart",
        },
    ],
}
