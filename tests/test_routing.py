"""Routing & execution audit for the aiogram dispatcher.

Two layers against a disposable copy (temp DB, all Telegram I/O mocked):

  Layer B (execution smoke) — feeds REAL updates through real handlers and
      asserts: zero handler/middleware errors, expected API calls made,
      expected DB side effects.

  Layer A (routing matrix)  — rebuilds the dispatcher with handler callbacks
      replaced by recorders and asserts exactly which handler matches each
      update (including negative cases: caption commands, unknown commands,
      unknown callbacks → no handler).

Run:  python tests\test_routing.py
"""

import asyncio
import glob
import os
import shutil
import sys
import tempfile
from unittest.mock import AsyncMock, patch

GROUP_ID = -100111


# ── Update factories ──────────────────────────

def _user(uid=111, name="Alice", username="alice", is_bot=False):
    u = {"id": uid, "is_bot": is_bot, "first_name": name}
    if username:
        u["username"] = username
    return u


def _chat(cid=GROUP_ID, ctype="supergroup", title="Test Group"):
    c = {"id": cid, "type": ctype}
    if title:
        c["title"] = title
    return c


def _msg(mid=1, text=None, ctype="supergroup", cid=GROUP_ID, uid=111,
         entities=None, extra=None):
    m = {"message_id": mid, "date": 1700000000, "chat": _chat(cid, ctype),
         "from": _user(uid)}
    if text is not None:
        m["text"] = text
    if entities:
        m["entities"] = entities
    if extra:
        m.update(extra)
    return m


def _cmd(name):  # bot_command entity covering the token, e.g. "/gban"
    return [{"offset": 0, "length": len(name), "type": "bot_command"}]


# ── Fake Telegram API ─────────────────────────

def _fake_message():
    from aiogram.types import Message
    return Message.model_validate(
        {"message_id": 777, "date": 1700000000, "chat": {"id": 42, "type": "private"}})


async def _fake_make_request(self, bot, method, timeout=None):
    api = getattr(method, "__api_method__", type(method).__name__)
    API_CALLS.append(api)
    if api in (
        "sendMessage", "sendPhoto", "sendDice", "editMessageText", "forwardMessage",
        # Bot API 10.1+ Rich Messages (rich.py declares these as raw methods).
        "sendRichMessage",
    ):
        return _fake_message()
    if api == "getChatMember":
        from aiogram.types import ChatMemberMember
        return ChatMemberMember.model_validate(
            {"status": "member", "user": _user()})
    return True


API_CALLS: list = []
ERRORS: list = []
HIT: list = []  # recorder hits: (observer, callback_qualname)


def _record_callbacks(dp):
    """Replace every registered handler callback with a recorder (skip internal update observer)."""
    for router in dp.chain_tail:
        for obs_name, observer in router.observers.items():
            if obs_name == "update":
                continue
            for h in observer.handlers:
                qual = getattr(h.callback, "__qualname__", str(h.callback))

                async def rec(*_a, _obs=obs_name, _q=qual, **_k):
                    HIT.append((_obs, _q))
                h.callback = rec


def _observed(dp):
    return [(r.name, o) for r in dp.chain_tail for o in r.observers]


async def _error_rec(event):
    ERRORS.append(event.exception)
    return True


# ── Main ──────────────────────────────────────

def main() -> int:
    src = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    tmp = tempfile.mkdtemp(prefix="mergedbot_route_")
    try:
        shutil.copytree(
            src, tmp,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "tests"),
            dirs_exist_ok=True,
        )
        # deterministic: fresh DBs in the temp copy (shadow_game.db lives at
        # the package root; older copies may also have data/*.db)
        for pat in ("*.db", "data/*.db", "data/*.sqlite", "data/*.sqlite3"):
            for f in glob.glob(os.path.join(tmp, pat)):
                os.remove(f)
        sys.path.insert(0, tmp)
        os.environ.setdefault("BOT_TOKEN", "123456:TEST-TOKEN")
        os.environ.setdefault("OWNER_ID", "1")
        os.environ.pop("GEMINI_API_KEYS", None)

        from aiogram import Bot, F
        from aiogram.client.session.aiohttp import AiohttpSession
        from aiogram.types import ErrorEvent, Update, User
        from shadow_game_bot.bot import (
            on_startup, on_shutdown, build_dispatcher, resolve_allowed_updates,
        )
        from shadow_game_bot.context import app
        from shadow_game_bot.db.users import UserCollection

        async def run() -> None:
            bot = Bot(token=os.environ["BOT_TOKEN"], session=AiohttpSession(timeout=10))
            fake_me = AsyncMock(return_value=User(
                id=123456, is_bot=True, first_name="TestBot", username="testbot_merged"))
            with patch.object(Bot, "me", fake_me), \
                    patch.object(Bot, "set_my_commands", AsyncMock(return_value=True)), \
                    patch.object(AiohttpSession, "make_request", _fake_make_request):
                await on_startup(bot)

                # ── allowed updates include edited_message ─────────
                dp0 = build_dispatcher()
                allowed = resolve_allowed_updates(dp0)
                assert "edited_message" in allowed, f"edited_message missing: {allowed}"
                assert {"message", "callback_query", "chat_member",
                        "my_chat_member"} <= set(allowed), allowed

                # ══════════════════════════════════════════════════
                # LAYER B — real handlers execute without errors
                # ══════════════════════════════════════════════════
                dp = build_dispatcher()
                dp.errors.register(_error_rec)
                feed = lambda u: dp.feed_update(bot, Update.model_validate(u))  # noqa: E731

                # 1. /start in private (rich banner + event log + dm record)
                #    The rich path is now the primary reply; the HTML
                #    fallback must NOT be needed.  sendMessage here is only
                #    the log-group "New User Started Bot" event.
                API_CALLS.clear(); ERRORS.clear()
                await feed({"update_id": 1001, "message": _msg(
                    mid=1, text="/start", ctype="private", cid=111,
                    entities=_cmd("/start"))})
                assert not ERRORS, f"/start private errors: {ERRORS}"
                assert "sendRichMessage" in API_CALLS, \
                    f"rich start reply not sent: {API_CALLS}"
                assert await UserCollection(app.db).has_started_bot(111), \
                    "dm start not recorded"

                # 2. private text (no daily session → shadow DM fallback reply)
                API_CALLS.clear(); ERRORS.clear()
                await feed({"update_id": 1002, "message": _msg(
                    mid=2, text="hello", ctype="private", cid=111)})
                assert not ERRORS, f"private text errors: {ERRORS}"
                assert "sendMessage" in API_CALLS, API_CALLS

                # 3. group text (no game active → falls through silently)
                API_CALLS.clear(); ERRORS.clear()
                await feed({"update_id": 1003, "message": _msg(
                    mid=3, text="apple")})
                assert not ERRORS, f"group text errors: {ERRORS}"

                # 4. sgb: callback (global_ranking path in private)
                API_CALLS.clear(); ERRORS.clear()
                await feed({"update_id": 1004, "callback_query": {
                    "id": "1", "from": _user(), "chat_instance": "ci",
                    "data": "sgb:global_ranking",
                    "message": _msg(mid=51, ctype="private", cid=111)}})
                assert not ERRORS, f"sgb callback errors: {ERRORS}"
                assert "editMessageText" in API_CALLS or "answerCallbackQuery" in API_CALLS, \
                    API_CALLS

                # 5. ws: callback (tabbed help → edit)
                API_CALLS.clear(); ERRORS.clear()
                await feed({"update_id": 1005, "callback_query": {
                    "id": "2", "from": _user(), "chat_instance": "ci",
                    "data": "ws:help_game", "message": _msg(mid=52)}})
                assert not ERRORS, f"ws callback errors: {ERRORS}"
                assert "editMessageText" in API_CALLS, API_CALLS

                # 6. edited message with suspicious text → anti-cheat alert
                #    (middleware only — no edited handlers registered)
                API_CALLS.clear(); ERRORS.clear()
                await feed({"update_id": 1006,
                            "edited_message": _msg(mid=60, text="run auto-player now")})
                assert not ERRORS, f"edited message errors: {ERRORS}"
                assert "sendMessage" in API_CALLS, \
                    f"suspicious alert not sent: {API_CALLS}"

                # 7. bot added → event log to log group
                API_CALLS.clear(); ERRORS.clear()
                await feed({"update_id": 1007, "message": _msg(
                    mid=7, text=None,
                    extra={"new_chat_members": [
                        _user(123456, "TestBot", "testbot_merged", True)]})})
                assert not ERRORS, f"new_chat_members errors: {ERRORS}"
                assert "sendMessage" in API_CALLS, API_CALLS

                # 8. bot removed → event log
                API_CALLS.clear(); ERRORS.clear()
                await feed({"update_id": 1008, "message": _msg(
                    mid=8, text=None,
                    extra={"left_chat_member":
                           _user(123456, "TestBot", "testbot_merged", True)})})
                assert not ERRORS, f"left_chat_member errors: {ERRORS}"
                assert "sendMessage" in API_CALLS, API_CALLS

                # 9. forum topic renamed → meta sync (topic pre-created)
                API_CALLS.clear(); ERRORS.clear()
                await app.ws_db.set_game_topic(str(GROUP_ID), "70")
                await feed({"update_id": 1009, "message": _msg(
                    mid=9, text=None, extra={
                        "message_thread_id": 70,
                        "forum_topic_edited": {"name": "Renamed"}})})
                assert not ERRORS, f"forum_topic_edited errors: {ERRORS}"
                topic = await app.ws_db.get_topic(str(GROUP_ID), "70")
                assert topic and topic.get("name") == "Renamed", topic

                # 10. chat_member + my_chat_member → tracking handlers
                API_CALLS.clear(); ERRORS.clear()
                await feed({"update_id": 1010, "chat_member": {
                    "chat": _chat(), "from": _user(uid=222, name="Bob", username="bob"),
                    "date": 1700000000,
                    "old_chat_member": {"status": "member",
                                         "user": _user(uid=222, name="Bob", username="bob")},
                    "new_chat_member": {"status": "creator", "is_anonymous": False,
                                         "user": _user(uid=222, name="Bob", username="bob")}}})
                await feed({"update_id": 1011, "my_chat_member": {
                    "chat": _chat(), "from": _user(uid=222, name="Bob", username="bob"),
                    "date": 1700000000,
                    "old_chat_member": {
                        "status": "administrator", "can_be_edited": False,
                        "is_anonymous": False, "can_manage_chat": True,
                        "can_delete_messages": True, "can_manage_video_chats": True,
                        "can_restrict_members": True, "can_promote_members": True,
                        "can_change_info": True, "can_invite_users": True,
                        "can_post_stories": False, "can_edit_stories": False,
                        "can_delete_stories": False,
                        "user": _user(123456, "TestBot", "testbot", True)},
                    "new_chat_member": {"status": "member",
                                         "user": _user(123456, "TestBot", "testbot", True)}}})
                assert not ERRORS, f"chat_member errors: {ERRORS}"

                # 11. sync middleware ran for every message kind (ws_ upsert)
                u = await app.ws_db.get_user("111")
                assert u is not None, "user 111 not synced into ws_ tables"

                # 12. caption command → NO handler (mid-flight negative, real dp)
                API_CALLS.clear(); ERRORS.clear()
                await feed({"update_id": 1012, "message": _msg(
                    mid=12, text=None, ctype="private", cid=111,
                    extra={"caption": "/start",
                           "caption_entities": _cmd("/start")})})
                assert not ERRORS, f"caption errors: {ERRORS}"
                assert API_CALLS == [], f"caption command hit the API: {API_CALLS}"

                # 13. start:help callback → interactive menu (Pi-style
                #     replace: fresh rich send + delete the old message)
                API_CALLS.clear(); ERRORS.clear()
                await feed({"update_id": 1013, "callback_query": {
                    "id": "9", "from": _user(), "chat_instance": "ci",
                    "data": "start:help", "message": _msg(mid=61)}})
                assert not ERRORS, f"start:help callback errors: {ERRORS}"
                assert "sendRichMessage" in API_CALLS, API_CALLS

                # ── UNO (mau mau) feeds ────────────────────────────

                # 14. /newuno in group → creates game
                API_CALLS.clear(); ERRORS.clear()
                await feed({"update_id": 1014, "message": _msg(
                    mid=14, text="/newuno", entities=_cmd("/newuno"))})
                assert not ERRORS, f"/newuno errors: {ERRORS}"
                assert "sendMessage" in API_CALLS, API_CALLS
                assert app.uno_gm.chatid_games.get(GROUP_ID), \
                    "UNO game not created"

                # 15. /join → seated in the game
                API_CALLS.clear(); ERRORS.clear()
                await feed({"update_id": 1015, "message": _msg(
                    mid=15, text="/join", entities=_cmd("/join"))})
                assert not ERRORS, f"/join errors: {ERRORS}"
                assert "sendMessage" in API_CALLS, API_CALLS
                assert 111 in app.uno_gm.userid_players, \
                    "user 111 not seated"

                # 16. /startuno with 1 player → min-players warning
                API_CALLS.clear(); ERRORS.clear()
                await feed({"update_id": 1016, "message": _msg(
                    mid=16, text="/startuno", entities=_cmd("/startuno"))})
                assert not ERRORS, f"/startuno errors: {ERRORS}"
                assert "sendMessage" in API_CALLS, API_CALLS

                # 17. inline query (game not started, creator) → modes
                API_CALLS.clear(); ERRORS.clear()
                await feed({"update_id": 1017, "inline_query": {
                    "id": "iq1", "from": _user(), "query": "", "offset": ""}})
                assert not ERRORS, f"inline_query errors: {ERRORS}"
                assert "answerInlineQuery" in API_CALLS, API_CALLS

                # 18. chosen inline result mode_classic → set mode
                API_CALLS.clear(); ERRORS.clear()
                await feed({"update_id": 1018, "chosen_inline_result": {
                    "result_id": "mode_classic:0",
                    "from": _user(), "query": ""}})
                assert not ERRORS, f"chosen_inline_result errors: {ERRORS}"
                assert "sendMessage" in API_CALLS, API_CALLS
                uno_game = app.uno_gm.chatid_games[GROUP_ID][-1]
                assert uno_game.mode == "classic", uno_game.mode

                # 19. human left_chat_member (not in UNO) → silent cleanup
                API_CALLS.clear(); ERRORS.clear()
                await feed({"update_id": 1019, "message": _msg(
                    mid=19, text=None,
                    extra={"left_chat_member":
                           _user(999, "Leaver", "leaver")})})
                assert not ERRORS, f"human left errors: {ERRORS}"

                # ══════════════════════════════════════════════════
                # LAYER A — routing matrix with recorder callbacks
                # ══════════════════════════════════════════════════
                HIT.clear()
                dp2 = build_dispatcher()
                dp2.errors.register(_error_rec)
                _record_callbacks(dp2)
                feed2 = lambda u: dp2.feed_update(  # noqa: E731
                    bot, Update.model_validate(u))

                async def route(u) -> list:
                    HIT.clear()
                    await feed2(u)
                    return list(HIT)

                # commands (no args) → commands router
                hits = await route({"update_id": 2001, "message": _msg(
                    mid=21, text="/new5", entities=_cmd("/new5"))})
                assert hits and hits[0][0] == "message" and "new5_handler" in hits[0][1], hits

                # commands (with args) → commands router
                hits = await route({"update_id": 2002, "message": _msg(
                    mid=22, text="/score global week 5",
                    entities=_cmd("/score"))})
                assert hits and "score_handler" in hits[0][1], hits

                # owner command with args
                hits = await route({"update_id": 2003, "message": _msg(
                    mid=23, text="/gban 999", entities=_cmd("/gban"),
                    ctype="private", cid=111)})
                assert hits and "gban_handler" in hits[0][1], hits

                # group admin command
                hits = await route({"update_id": 2004, "message": _msg(
                    mid=24, text="/setgametopic", entities=_cmd("/setgametopic"))})
                assert hits and "setgametopic_handler" in hits[0][1], hits

                # plain group text → group text router
                hits = await route({"update_id": 2005, "message": _msg(
                    mid=25, text="wordle")})
                assert hits and "message_handler" in hits[0][1], hits

                # plain private text → private text router
                hits = await route({"update_id": 2006, "message": _msg(
                    mid=26, text="secret", ctype="private", cid=111)})
                assert hits and "handle_private_message" in hits[0][1], hits

                # unknown command → NO handler (falls through, silent)
                hits = await route({"update_id": 2007, "message": _msg(
                    mid=27, text="/doesnotexist", entities=_cmd("/doesnotexist"))})
                assert hits == [], hits

                # unknown callback prefix → NO handler
                hits = await route({"update_id": 2008, "callback_query": {
                    "id": "3", "from": _user(), "chat_instance": "ci",
                    "data": "other:thing", "message": _msg(mid=53)}})
                assert hits == [], hits

                # sgb + ws prefixes route to their own handlers
                hits = await route({"update_id": 2009, "callback_query": {
                    "id": "4", "from": _user(), "chat_instance": "ci",
                    "data": "sgb:volunteer", "message": _msg(mid=54)}})
                assert hits and "callback_handler" in hits[0][1], hits
                hits = await route({"update_id": 2010, "callback_query": {
                    "id": "5", "from": _user(), "chat_instance": "ci",
                    "data": "ws:vote_end -100111", "message": _msg(mid=55)}})
                assert hits and "ws_callback_handler" in hits[0][1], hits

                # help: + start: prefixes route to the Pi menu handlers
                hits = await route({"update_id": 2011, "callback_query": {
                    "id": "6", "from": _user(), "chat_instance": "ci",
                    "data": "help:main:0", "message": _msg(mid=56)}})
                assert hits and "help_callback" in hits[0][1], hits
                hits = await route({"update_id": 2012, "callback_query": {
                    "id": "7", "from": _user(), "chat_instance": "ci",
                    "data": "start:help", "message": _msg(mid=57)}})
                assert hits and "start_callback" in hits[0][1], hits

                # UNO commands route to their handlers
                hits = await route({"update_id": 2013, "message": _msg(
                    mid=31, text="/newuno", entities=_cmd("/newuno"))})
                assert hits and "newuno_handler" in hits[0][1], hits
                hits = await route({"update_id": 2014, "message": _msg(
                    mid=32, text="/newword", entities=_cmd("/newword"))})
                assert hits and "new_game_handler" in hits[0][1], hits
                hits = await route({"update_id": 2015, "message": _msg(
                    mid=33, text="/startuno", entities=_cmd("/startuno"))})
                assert hits and "startuno_handler" in hits[0][1], hits
                hits = await route({"update_id": 2016, "message": _msg(
                    mid=34, text="/join", entities=_cmd("/join"))})
                assert hits and "join_handler" in hits[0][1], hits

                # UNO callback prefix
                hits = await route({"update_id": 2017, "callback_query": {
                    "id": "8", "from": _user(), "chat_instance": "ci",
                    "data": "mm:join", "message": _msg(mid=58)}})
                assert hits and "mm_callback_handler" in hits[0][1], hits

                # UNO inline observers
                hits = await route({"update_id": 2018, "inline_query": {
                    "id": "iq2", "from": _user(), "query": "", "offset": ""}})
                assert hits and "reply_to_query" in hits[0][1], hits
                hits = await route({"update_id": 2019, "chosen_inline_result": {
                    "result_id": "hand:0", "from": _user(), "query": ""}})
                assert hits and "process_result" in hits[0][1], hits

                assert not ERRORS, f"routing matrix errors: {ERRORS}"

                await on_shutdown()

            print(f"  layer B: 19 execution feeds — 0 errors, API+DB effects verified")
            print(f"  layer A: 19 routing cases — exact handler matches verified")
            print(f"  allowed updates: {allowed}")

        asyncio.run(run())
        print("PASS routing & execution audit")
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
