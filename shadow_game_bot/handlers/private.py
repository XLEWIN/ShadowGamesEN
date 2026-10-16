"""Handler for private (DM) messages — word submission workflow."""

import logging

from aiogram.types import Message

from shadow_game_bot.context import app
from shadow_game_bot.db.games import GamesCollection
from shadow_game_bot.db.users import UserCollection
from shadow_game_bot.core.engine import GameEngine
from shadow_game_bot.emojis import E
from shadow_game_bot.reply import reply_text
from shadow_game_bot.utils.escaping import escape_html

logger = logging.getLogger(__name__)


async def private_message_handler(message: Message) -> None:
    if not message.chat or not message.from_user:
        return
    if message.chat.type != "private":
        return

    user_id = message.from_user.id
    db = app.db

    if await UserCollection(db).is_gbanned(user_id):
        await reply_text(message, f"{E.BAN} You are globally banned from using this bot.")
        return

    text = message.text.strip() if message.text else ""
    if not text or text.startswith("/"):
        return

    dm_actions = app.dm_actions
    pending = dm_actions.get(user_id)
    if pending is None:
        # Restore from DB (survives restarts)
        try:
            cursor = await db.execute(
                "SELECT user_id, game_chat_id, action, game_id FROM dm_actions "
                "WHERE user_id = ? ORDER BY id DESC LIMIT 1",
                (user_id,),
            )
            row = await cursor.fetchone()
        except Exception:
            row = None
        if row:
            from shadow_game_bot.core.state import DMActionType, PendingDMAction
            pending = PendingDMAction(
                user_id=row[0], game_chat_id=row[1],
                action=DMActionType(row[2]) if row[2] in DMActionType._value2member_map_ else DMActionType.WRITE_WORD,
                game_id=row[3],
            )
            dm_actions[user_id] = pending

    if pending is None:
        await reply_text(
            message,
            f"{E.INFO} I'm waiting for an action from a game.\n"
            "Use the game buttons in a group chat to interact with me.")
        return

    if len(text) > 50:
        await reply_text(
            message, f"{E.WARNING} Please send a valid word (1-50 characters).")
        return

    engine: GameEngine = app.engine
    games_col = GamesCollection(db)
    success = await engine.set_custom_word(pending.game_chat_id, text.strip())
    del dm_actions[user_id]
    try:
        await db.execute("DELETE FROM dm_actions WHERE user_id = ?", (user_id,))
        await db.commit()
    except Exception:
        logger.warning("Could not clear dm_action for %s", user_id, exc_info=True)

    if success:
        await reply_text(
            message,
            f"{E.SUCCESS} Your word has been set to:\n\n"
            f"<code>{escape_html(text.strip().upper())}</code>",
            parse_mode="HTML",
        )
        try:
            await app.bot.send_message(
                pending.game_chat_id,
                f"{E.INFO} The current word has been changed by the leader.",
                parse_mode="HTML",
            )
        except Exception as e:
            logger.warning("Could not notify group %s: %s", pending.game_chat_id, e)
        await games_col.update_activity(pending.game_chat_id)
    else:
        await reply_text(
            message,
            f"{E.ERROR} Could not set the word. The game may have ended.")
