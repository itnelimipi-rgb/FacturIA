# Entrada legada: ejecuta la misma suite TypeScript real, sin duplicar el motor.
import subprocess
import sys
from pathlib import Path
root = Path(__file__).resolve().parents[1]
sys.exit(subprocess.run(['node', 'scripts/run-tests.mjs'], cwd=root).returncode)
