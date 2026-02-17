"""
sync_brain.py - Brain-to-Extension Auto-Sync
 
Watches data/output/log10_processes.json and auto-copies it
to unified-extension/data/ whenever the brain updates it.

Run from project root:
    python sync_brain.py

No dependencies - uses only stdlib.
"""

import shutil
import time
import os
from pathlib import Path

# Paths
ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "data" / "output" / "log10_processes.json"
DEST = ROOT / "unified-extension" / "data" / "log10_processes.json"


def sync_file():
    """Copy brain output to extension"""
    try:
        if not SOURCE.exists():
            print(f"[sync] ⚠️  Source not found: {SOURCE}")
            return
        
        shutil.copy2(SOURCE, DEST)
        print(f"[sync] ✓  Synced → {DEST.name}")
    except Exception as e:
        print(f"[sync] ✗  Failed: {e}")


def get_mtime(path):
    """Get file modification time"""
    try:
        return path.stat().st_mtime
    except FileNotFoundError:
        return 0.0


def main():
    print("[sync] 🔄 Brain-to-Extension Auto-Sync Started")
    print(f"[sync] 👁  Watching: {SOURCE}")
    print(f"[sync] 📂 Target: {DEST}")
    print("[sync]     Press Ctrl+C to stop\n")
    
    # Initial sync
    sync_file()
    last_mtime = get_mtime(SOURCE)
    
    # Watch loop
    try:
        while True:
            time.sleep(1)
            current_mtime = get_mtime(SOURCE)
            
            if current_mtime > last_mtime:
                sync_file()
                last_mtime = current_mtime
    
    except KeyboardInterrupt:
        print("\n[sync] Stopped. Bye!")


if __name__ == "__main__":
    main()