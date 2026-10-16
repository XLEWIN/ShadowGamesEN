"""Word normalization for consistent comparison."""

import unicodedata


def normalize_word(text: str) -> str:
    """Normalize: strip, NFKD, casefold, collapse whitespace."""
    text = unicodedata.normalize("NFKD", text.strip())
    text = text.casefold()
    return " ".join(text.split())


def is_correct_guess(guess: str, target_word: str) -> bool:
    return normalize_word(guess) == normalize_word(target_word)
