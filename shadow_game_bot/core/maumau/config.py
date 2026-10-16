"""UNO game constants (ported from mau_mau_bot config.py, env-free).

Hard-coded defaults from the original bot; no config.json / env lookups —
the merged bot keeps settings in shadow_game_bot.config.
"""

# Game modes: classic / fast (Sanic) / wild.  The original also had a
# "text" mode that only changed sticker rendering; our cards are always
# text, so that mode is dropped.
GAME_MODES = ("classic", "fast", "wild")

DEFAULT_GAMEMODE = "fast"

# Seconds a player has to act in fast mode before /skip or auto-skip.
WAITING_TIME = 120
# Seconds subtracted from waiting_time each time the player is skipped.
TIME_REMOVAL_AFTER_SKIP = 20
# Floor for the fast-mode countdown so a heavily-skipped player still
# gets a minimum window.
MIN_FAST_TURN_TIME = 15
# Minimum players required to /start a game.
MIN_PLAYERS = 2
# Lobby open by default (players may /join before /start).
OPEN_LOBBY = True
