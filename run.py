"""Merged Shadow + WordSeek Bot - Quick launcher.

Run from the MergedBot/ directory:
    python run.py
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from shadow_game_bot.bot import main

if __name__ == "__main__":
    main()
