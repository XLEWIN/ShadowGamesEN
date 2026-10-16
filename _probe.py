import asyncio
import logging
import sys

sys.path.insert(0, r"C:\Users\pixlb\OneDrive\Documents\SdwGameBot\MergedBot")
sys.stdout.reconfigure(encoding="utf-8")
logging.basicConfig(level=logging.DEBUG, format="%(name)s %(levelname)s %(message)s")

from aiogram.types import Update, User, ChosenInlineResult
from shadow_game_bot.bot import build_dispatcher


class FakeBot:
    id = 999
    username = "fake"

    def __getattr__(self, name):
        async def _(*a, **k):
            return None
        return _


dp = build_dispatcher()
u = Update(
    update_id=1,
    chosen_inline_result=ChosenInlineResult(
        result_id="card:0",
        inline_message_id=None,
        query="",
        from_user=User(id=1, is_bot=False, first_name="A"),
    ),
)


async def main():
    try:
        await dp.feed_update(bot=FakeBot(), update=u)
        print("NO RAISE")
    except Exception as e:
        import traceback
        traceback.print_exc()
        print("RAISED:", type(e).__name__, e)


asyncio.run(main())
