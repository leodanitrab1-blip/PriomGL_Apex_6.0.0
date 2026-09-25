#!/usr/bin/env python3
"""
Servidor HTTP mínimo (solo stdlib) para desplegar PriomGL en Render u otro host.
Uso: python3 serve.py [--port 8080]
"""
from __future__ import annotations
import argparse
import functools
import http.server
import os
import socketserver
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        # CORS básico por si se prueba desde otro origen
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8080")))
    args = parser.parse_args()
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", args.port), Handler) as httpd:
        print(f"PriomGL Polyglot serving {ROOT} on :{args.port}")
        httpd.serve_forever()

if __name__ == "__main__":
    main()
