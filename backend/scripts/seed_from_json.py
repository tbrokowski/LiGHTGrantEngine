#!/usr/bin/env python3
"""Load global grant pool from JSON and fan out to all institutions."""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.grant_bootstrap import run_full_bootstrap


if __name__ == "__main__":
    result = run_full_bootstrap()
    print("Bootstrap complete:", result)
