"""All bot commands — game, ranking, and admin."""

import logging
from datetime import datetime, timezone

from aiogram.types import InlineKeyboardMarkup, Message
from aiogram.filters import CommandObject

from shadow_game_bot.config import config
from shadow_game_bot.context import app
from shadow_game_bot.db.games import GamesCollection
from shadow_game_bot.db.players import PlayersCollection
from shadow_game_bot.db.users import UserCollection
from shadow_game_bot.emojis import E, EID
from shadow_game_bot.keyboards.colored import btn_primary, btn_success, btn_url
from shadow_game_bot.reply import reply_text
from shadow_game_bot.utils.escaping import escape_html
from shadow_game_bot.utils.mentions import mention_user_html, get_display_name

logger = logging.getLogger(__name__)


# ── Helpers ───────────────────────────────────

def _is_owner(user_id: int) -> bool:
    return user_id == config.owner_id


async def _check_dm_started(message: Message) -> bool:
    """Check DM start + gban. Returns True if OK."""
    if not message.from_user:
        return True

    user_id = message.from_user.id
    db = app.db
    users_col = UserCollection(db)

    if await users_col.is_gbanned(user_id):
        await reply_text(message, f"{E.BAN} You are globally banned from using this bot.")
        return False

    if await users_col.has_started_bot(user_id):
        return True

    mention = mention_user_html(user_id, get_display_name(message.from_user))
    text = (
        f"{E.WAVE} Hey {mention}!\n\n"
        f"To play <b>Shadow Game</b>, you need to start me in private first!\n\n"
        f"{E.ARROW} It only takes a second — tap the button below."
    )
    keyboard = [[btn_url(
        "Start Me in Private",
        f"https://t.me/{app.bot_username}?start=help",
        icon_emoji_id=EID.WAVE,
        style="primary",
    )]]
    await reply_text(message, text, parse_mode="HTML",
                     reply_markup=InlineKeyboardMarkup(inline_keyboard=keyboard))
    return False


# ── /help (Pi-style interactive menu) ─────────

async def help_handler(message: Message) -> None:
    if not await _check_dm_started(message):
        return
    from shadow_game_bot.handlers.menu import help_command
    await help_command(message)


# ── /rules ────────────────────────────────────

async def rules_handler(message: Message) -> None:
    if not await _check_dm_started(message):
        return
    await reply_text(
        message,
        f"{E.INFO} <b>Game Rules</b>\n{E.BULLET}\n\n"
        f"{E.GAME} <b>Word Guess</b>\n"
        "In this game, there are two roles: leader and participants. "
        "The leader chooses a random secret word and describes it without actually saying it. "
        "The goal for the other participants is to guess the word and type it in the group chat.\n\n"
        f"{E.TROPHY} <b>About Rewards</b>\n"
        "You win 1 Xeon if you:\n"
        f"{E.CHECK} Are the first person to guess (type) the correct word.\n\n"
        '<i>The "Xeons" represents an in-game currency only and has no '
        "real-world monetary value.</i>",
        parse_mode="HTML",
    )


# ── /mystats ──────────────────────────────────

async def mystats_handler(message: Message) -> None:
    if not message.chat or not message.from_user:
        return
    if not await _check_dm_started(message):
        return

    user_id = message.from_user.id
    db = app.db
    players_col = PlayersCollection(db)
    games_col = GamesCollection(db)

    global_stats = await players_col.get_user_global_stats(user_id)
    if not global_stats:
        return await reply_text(
            message,
            f"{E.INFO} You haven't played any games yet. Use /game to start playing!")

    top_chat = await players_col.get_user_top_chat(user_id)
    display_name = escape_html(global_stats.get("display_name") or "Unknown")
    username = global_stats.get("username")

    text = f"{E.USER} <b>Your Profile</b>\n{E.BULLET}\n\n"
    text += f"📝 <b>Username:</b> @{username}\n" if username else f"📝 <b>Name:</b> {display_name}\n"
    text += f"🎮 <b>Display Name:</b> {display_name}\n"
    text += f"💰 <b>Total Xeons:</b> {global_stats.get('total_xeons', 0)}\n"
    text += f"🔤 <b>Words Guessed:</b> {global_stats.get('total_words_guessed', 0)}\n"
    text += f"🎯 <b>Games Played:</b> {global_stats.get('games_played', 0)}\n\n"

    if top_chat:
        chat_name = top_chat.get("chat_name")
        chat_id = top_chat.get("chat_id")
        if not chat_name and chat_id:
            try:
                chat = await app.bot.get_chat(chat_id)
                chat_name = chat.title
                await games_col.update_chat_name(chat_id, chat_name)
            except Exception:
                chat_name = f"Chat {chat_id}"
        elif not chat_name:
            chat_name = "Unknown Chat"
        text += f"{E.TROPHY} <b>Top Chat:</b> {escape_html(chat_name or 'Unknown Chat')}\n   Words Guessed There: {top_chat.get('words_guessed', 0)}\n"
    else:
        text += f"{E.TROPHY} <b>Top Chat:</b> None yet\n"

    text += f"\n{E.BULLET}"
    keyboard = [[btn_primary(
        "Check Global Ranking", "sgb:global_ranking",
        icon_emoji_id=EID.TROPHY,
    )]]
    await reply_text(message, text, parse_mode="HTML",
                     reply_markup=InlineKeyboardMarkup(inline_keyboard=keyboard))


# ── /ranking ──────────────────────────────────

async def ranking_handler(message: Message) -> None:
    if not message.chat:
        return
    if not await _check_dm_started(message):
        return
    if message.chat.type not in ("group", "supergroup"):
        return await reply_text(
            message, f"{E.WARNING} Use this command in a group chat.")

    chat_id = message.chat.id
    db = app.db
    games_col = GamesCollection(db)

    game = await games_col.get_active_game(chat_id)
    if not game:
        return await reply_text(
            message, f"{E.INFO} No active game. Use /game to start one!")

    leaderboard = await PlayersCollection(db).get_leaderboard(game["id"], limit=25)
    if not leaderboard:
        return await reply_text(
            message, f"{E.INFO} No scores yet. Start a game first!")

    text = f"{E.TROPHY} <b>Top 25 Players (This Chat)</b>\n{E.BULLET}\n\n"
    medals = [E.MEDAL_1, E.MEDAL_2, E.MEDAL_3]
    for i, player in enumerate(leaderboard):
        medal = medals[i] if i < len(medals) else f"  {i+1}."
        text += (f"{medal} <b>{escape_html(player.get('display_name') or 'Unknown')}</b>\n"
                 f"   💰 {player.get('score', 0)} Xeons | 🔤 {player.get('words_guessed', 0)} words\n\n")
    await reply_text(message, text, parse_mode="HTML")


# ── /globalranking ────────────────────────────

async def globalranking_handler(message: Message) -> None:
    if not await _check_dm_started(message):
        return

    top_players = await PlayersCollection(app.db).get_global_top_players(limit=25)
    if not top_players:
        return await reply_text(message, f"{E.INFO} No scores yet globally.")

    text = f"{E.GLOBE} <b>Top 25 Players (Global)</b>\n{E.BULLET}\n\n"
    medals = [E.MEDAL_1, E.MEDAL_2, E.MEDAL_3]
    for i, player in enumerate(top_players):
        medal = medals[i] if i < len(medals) else f"  {i+1}."
        text += (f"{medal} <b>{escape_html(player.get('display_name') or 'Unknown')}</b>\n"
                 f"   💰 {player.get('total_score', 0)} Xeons\n\n")
    await reply_text(message, text, parse_mode="HTML")


# ── /chatranking ──────────────────────────────

async def chatranking_handler(message: Message) -> None:
    if not await _check_dm_started(message):
        return

    db = app.db
    games_col = GamesCollection(db)
    top_chats = await games_col.get_top_chats(limit=10)
    if not top_chats:
        return await reply_text(message, f"{E.INFO} No active chats yet.")

    text = f"{E.LOCATION} <b>Top 10 Chats (By Activity)</b>\n{E.BULLET}\n\n"
    medals = [E.MEDAL_1, E.MEDAL_2, E.MEDAL_3]
    for i, chat_info in enumerate(top_chats):
        medal = medals[i] if i < len(medals) else f"  {i+1}."
        chat_id = chat_info.get("chat_id", 0)
        chat_name = chat_info.get("chat_name")
        if not chat_name:
            try:
                chat = await app.bot.get_chat(chat_id)
                chat_name = chat.title
                await games_col.update_chat_name(chat_id, chat_name)
            except Exception:
                chat_name = f"Chat {chat_id}"
        text += (f"{medal} <b>{escape_html(chat_name)}</b>\n"
                 f"   👥 {chat_info.get('player_count', 0)} players\n\n")
    await reply_text(message, text, parse_mode="HTML")


# ── /game ─────────────────────────────────────

async def game_start_handler(message: Message, command: CommandObject) -> None:
    if not await _check_dm_started(message):
        return
    from shadow_game_bot.handlers.start import start_handler
    await start_handler(message, command)


# ── /stop ─────────────────────────────────────

async def stop_handler(message: Message) -> None:
    if not message.chat or not message.from_user:
        return
    if not await _check_dm_started(message):
        return
    if message.chat.type not in ("group", "supergroup"):
        return await reply_text(
            message, f"{E.WARNING} Use this command in a group chat.")

    chat_id = message.chat.id
    user_id = message.from_user.id
    db = app.db
    games_col = GamesCollection(db)

    game = await games_col.get_active_game(chat_id)
    if not game:
        return await reply_text(message, f"{E.INFO} No active game to stop.")

    current_leader_id = game.get("current_leader_id")
    if user_id != current_leader_id:
        try:
            member = await app.bot.get_chat_member(chat_id, user_id)
            if member.status not in ("administrator", "creator"):
                return await reply_text(
                    message,
                    f"{E.LOCK} Only the current leader or a chat admin can stop the game.")
        except Exception:
            return await reply_text(
                message,
                f"{E.LOCK} Only the current leader or a chat admin can stop the game.")

    leaderboard = await PlayersCollection(db).get_leaderboard(game["id"], limit=3)
    category = game.get("category", "normal")
    mode_label = "Normal" if category == "normal" else "Fiction"
    success = await games_col.end_game(chat_id)

    if not success:
        return await reply_text(message, f"{E.ERROR} Could not stop the game.")

    for msg_id in [game.get("leader_message_id"), game.get("leader_selection_message_id")]:
        if msg_id:
            try:
                await app.bot.delete_message(chat_id, msg_id)
            except Exception:
                pass

    if leaderboard:
        text = f"{E.GAME} <b>Game Over!</b> ({mode_label} Mode) Top Players:\n\n"
        medals = [E.MEDAL_1, E.MEDAL_2, E.MEDAL_3]
        for i, player in enumerate(leaderboard):
            medal = medals[i] if i < len(medals) else f"  {i+1}."
            text += (f"{medal} {escape_html(player.get('display_name') or 'Unknown')}"
                     f" — {player.get('score', 0)} Xeons\n")
        keyboard = [[btn_success(
            "Start New Game", "sgb:start_new", icon_emoji_id=EID.FRESH)]]
        await reply_text(message, text, parse_mode="HTML",
                         reply_markup=InlineKeyboardMarkup(inline_keyboard=keyboard))
    else:
        await reply_text(
            message, f"{E.SUCCESS} Game stopped! Use /game to start a new game.")


# ── /score (smart routing) ────────────────────

async def score_handler(message: Message, command: CommandObject) -> None:
    """Merged /score.

    - Has args           → WordSeek /score (user/scope/period/length lookup)
    - No args + shadow game active in this chat → Word Guess scoreboard
    - Otherwise          → WordSeek own-score view
    """
    if command and command.args:
        from shadow_game_bot.handlers.ws_commands import score_handler as ws_score_handler
        return await ws_score_handler(message, command)

    if (message.chat
            and message.chat.type in ("group", "supergroup")):
        games_col = GamesCollection(app.db)
        game = await games_col.get_active_game(message.chat.id)
        if game:
            return await ranking_handler(message)

    from shadow_game_bot.handlers.ws_commands import score_handler as ws_score_handler
    return await ws_score_handler(message, command)


# ══════════════════════════════════════════════
#  OWNER COMMANDS
# ══════════════════════════════════════════════

# ── /resetdata ────────────────────────────────

async def resetdata_handler(message: Message) -> None:
    if not message.from_user:
        return
    if not _is_owner(message.from_user.id):
        return await reply_text(message, f"{E.LOCK} This command is owner only.")

    db = app.db
    for table in ["game_players", "rounds", "games", "dm_actions", "user_started_bot", "gbanned_users"]:
        await db.execute(f"DELETE FROM {table}")
    await db.execute("DELETE FROM sqlite_sequence WHERE name IN ('game_players','rounds','games','dm_actions')")
    await db.commit()

    logger.warning("RESETDATA: All stats reset by owner %s", message.from_user.id)
    await reply_text(
        message, f"{E.SUCCESS} All rankings, stats, and user data have been reset.")


# ── /stats ────────────────────────────────────

async def stats_handler(message: Message) -> None:
    if not message.from_user:
        return
    if not _is_owner(message.from_user.id):
        return await reply_text(message, f"{E.LOCK} This command is owner only.")

    db = app.db

    async def _count(query):
        cursor = await db.execute(query)
        row = await cursor.fetchone()
        return row[0] if row else 0

    total_users = await _count("SELECT COUNT(*) FROM user_started_bot")
    total_games = await _count("SELECT COUNT(*) FROM games")
    total_chats = await _count("SELECT COUNT(DISTINCT chat_id) FROM games")
    total_words = await _count("SELECT SUM(words_guessed) FROM game_players")
    total_xeons = await _count("SELECT SUM(score) FROM game_players")
    active_games = await _count("SELECT COUNT(*) FROM games WHERE game_active = 1")
    total_word_pool = await _count("SELECT COUNT(*) FROM words WHERE active = 1")
    gbanned = await _count("SELECT COUNT(*) FROM gbanned_users")

    text = (
        f"{E.INFO} <b>Bot Statistics</b>\n{E.BULLET}\n\n"
        f"Users (started bot): {total_users}\n"
        f"Total chats: {total_chats}\n"
        f"Total games played: {total_games}\n"
        f"Active games: {active_games}\n\n"
        f"Words guessed (total): {total_words}\n"
        f"Xeons earned (total): {total_xeons}\n"
        f"Word pool size: {total_word_pool}\n\n"
        f"Gbanned users: {gbanned}"
    )

    # WordSeek statistics
    ws_db = app.ws_db
    if ws_db is not None:
        try:
            ws_users = await ws_db.count_users()
            ws_players = await ws_db.count_leaderboard_players()
            ws_groups = await ws_db.count_leaderboard_groups()
            ws_active = await _count("SELECT COUNT(*) FROM ws_games")

            async def _ws_count(query):
                cursor = await db.execute(query)
                row = await cursor.fetchone()
                return row[0] if row else 0

            ws_guesses = await _ws_count("SELECT COUNT(*) FROM ws_guesses")
            ws_daily_words = await _ws_count("SELECT COUNT(*) FROM ws_daily_words")

            text += (
                f"\n\n{E.BULLET}\n<b>WordSeek</b>\n"
                f"Known users: {ws_users}\n"
                f"Scored players: {ws_players}\n"
                f"Chats with scores: {ws_groups}\n"
                f"Active games: {ws_active}\n"
                f"Guesses logged: {ws_guesses}\n"
                f"Daily words generated: {ws_daily_words}"
            )
        except Exception as exc:
            text += f"\n\n(<i>WordSeek stats unavailable: {exc}</i>)"

    await reply_text(message, text, parse_mode="HTML")


# ── /gban ─────────────────────────────────────

async def gban_handler(message: Message, command: CommandObject) -> None:
    if not message.from_user:
        return
    if not _is_owner(message.from_user.id):
        return await reply_text(message, f"{E.LOCK} This command is owner only.")

    target_user_id = None
    target_name = None

    if message.reply_to_message and message.reply_to_message.from_user:
        target = message.reply_to_message.from_user
        target_user_id, target_name = target.id, target.full_name
    elif command and command.args:
        try:
            target_user_id = int(command.args.split()[0])
            target_name = f"User {target_user_id}"
        except ValueError:
            return await reply_text(
                message,
                f"{E.INFO} Usage: /gban &lt;user_id&gt; or reply to a user's message.",
                parse_mode="HTML")
    else:
        return await reply_text(
            message,
            f"{E.INFO} Usage: /gban &lt;user_id&gt; or reply to a user's message.",
            parse_mode="HTML")

    if target_user_id == config.owner_id:
        return await reply_text(message, f"{E.ERROR} You cannot gban yourself.")
    if target_user_id == app.bot.id:
        return await reply_text(message, f"{E.ERROR} I cannot gban myself.")

    db = app.db
    now = datetime.now(timezone.utc).isoformat()
    try:
        await db.execute(
            "INSERT INTO gbanned_users (user_id, banned_at) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET banned_at = excluded.banned_at",
            (target_user_id, now),
        )
        await db.commit()
    except Exception as e:
        return await reply_text(message, f"{E.ERROR} Error: {e}")

    logger.warning("GBAN: User %s (%s) gbanned by owner", target_user_id, target_name)
    try:
        await app.bot.ban_chat_member(message.chat.id, target_user_id)
    except Exception:
        pass
    await reply_text(
        message,
        f"{E.BAN} User {escape_html(target_name)} ({target_user_id}) "
        "has been globally banned from using the bot.",
        parse_mode="HTML")


# ── /ungban ───────────────────────────────────

async def ungban_handler(message: Message, command: CommandObject) -> None:
    if not message.from_user:
        return
    if not _is_owner(message.from_user.id):
        return await reply_text(message, f"{E.LOCK} This command is owner only.")

    target_user_id = None
    if message.reply_to_message and message.reply_to_message.from_user:
        target_user_id = message.reply_to_message.from_user.id
    elif command and command.args:
        try:
            target_user_id = int(command.args.split()[0])
        except ValueError:
            return await reply_text(
                message,
                f"{E.INFO} Usage: /ungban &lt;user_id&gt; or reply to a user's message.",
                parse_mode="HTML")
    else:
        return await reply_text(
            message,
            f"{E.INFO} Usage: /ungban &lt;user_id&gt; or reply to a user's message.",
            parse_mode="HTML")

    db = app.db
    cursor = await db.execute("DELETE FROM gbanned_users WHERE user_id = ?", (target_user_id,))
    await db.commit()
    await reply_text(
        message,
        f"{E.UNBAN} User {target_user_id} has been unbanned."
        if cursor.rowcount > 0
        else f"{E.INFO} User {target_user_id} was not gbanned.")
