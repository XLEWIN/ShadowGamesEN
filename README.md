# SdwGameBot — Merged Shadow + WordSeek + UNO Bot

One Telegram bot that combines **all three** games from the source repos:

| Game | Source | Engine |
|---|---|---|
| **Word Guess** (Wordle-style group game, rankings, DM workflow) | `ShadowgameBot-main` | Python / python-telegram-bot 21.6 + SQLite (aiosqlite) |
| **WordSeek** (regular group games, Daily WordSeek, leaderboards, streaks) | `WordSeek-master` | Ported from TypeScript/grammY + Postgres/Redis to Python |
| **UNO** (classic card game with inline cards, fast mode, bluff calls) | `mau_mau_bot-master` | Ported from python-telegram-bot to aiogram 3; Pony ORM → aiosqlite |

The merged bot runs on **aiogram 3** (the original WordSeek was grammY, a similar
async framework, so the port is 1:1). ShadowgameBot's token/env scheme (`BOT_TOKEN`,
`OWNER_ID`, `LOG_GROUP_ID`) and SQLite database are preserved. WordSeek's Postgres
tables live in the same SQLite file with a `ws_` prefix; Redis was replaced by an
in-process TTL store plus a few SQLite tables.

## Setup

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Configure
copy .env.example .env      # then edit: BOT_TOKEN, OWNER_ID, LOG_GROUP_ID

# 3. Run
python run.py
```

- `.env` is read from the project folder or from inside `shadow_game_bot/`.
- The database file (`shadow_game.db` by default) is created next to `run.py`.
- Word lists, share grid and the banner live in `data/`.

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `BOT_TOKEN` | ✅ | — | Telegram bot token |
| `OWNER_ID` | ✅ | — | Owner user id (enables `/stats`, `/gban`, `/resetdata`, WordSeek owner tools) |
| `LOG_GROUP_ID` | ✅ | — | Log group for bot events + anti-cheat alerts |
| `DATABASE_NAME` | | `shadow_game` | SQLite file base name |
| `INACTIVITY_TIMEOUT` | | `300` | Seconds before a Word Guess game auto-ends |
| `LOG_LEVEL` | | `INFO` | `DEBUG` / `INFO` / `WARNING` / `ERROR` |
| `TIME_ZONE` | | `Asia/Calcutta` | Daily WordSeek rollover at 06:00 in this zone |
| `DAILY_WORDLE_SECRET` | | built-in | Seed for the deterministic daily-word shuffle |
| `DAILY_WORDLE_START_DATE` | | `2025-01-01` | First day of the rotation (`YYYY-MM-DD`) |
| `GEMINI_API_KEYS` | | empty | Optional: meanings/phonetics/examples for Daily WordSeek (space/comma separated). Without keys the daily game still works, just without meanings |
| `LOGS_CHANNEL` | | `LOG_GROUP_ID` | Optional separate anti-cheat alert channel |
| `ADMIN_USERS` | | empty | Extra admin user ids (space/comma separated) |

## Commands

### WordSeek (ported from WordSeek-master)
| Command | Who | What |
|---|---|---|
| `/new`, `/new4`, `/new5`, `/new6` | everyone | Start a regular WordSeek game (default 5 letters) |
| `/end` | everyone / game starter | End the WordSeek game |
| `/daily` | private chat | Daily WordSeek (6 attempts, streaks, 06:00 rollover) |
| `/pausedaily` | private chat | Pause today's daily game |
| `/leaderboard` | everyone | Group/global leaderboard with filters (`global`, `week`, `4`…) |
| `/score [@user] [filters]` | everyone | Your (or another user's) regular + daily scores |
| `/id` | everyone | Message / user info |
| `/setgametopic`, `/unsetgametopic`, `/allowonlylen`, `/recreatetopic`, `/seekauth` | group admins | Topic, word-length and authorization settings |
| `/ban`, `/unban` | owner | Alias for `/gban` / `/ungban` |
| `/transfer`, `/track`, `/untrack`, `/tracklist` | owner | Score transfer + chat tracking |
| `/broadcast`, `/broadcast_status`, `/broadcast_cancel` | owner | Owner broadcast (resumes after restart) |
| `/captcha` | owner | Slot-machine captcha (set in a group; users must tap the right emoji) |

### Word Guess (ShadowgameBot)
`/start`, `/help`, `/rules`, `/game`, `/stop`, `/score`, `/stats`, `/mystats`,
`/ranking`, `/globalranking`, `/chatranking`, `/game`…

### UNO (mau mau, ported)
| Command | Who | What |
|---|---|---|
| `/newuno` | everyone | Create a new UNO game (clashing `/new` kept for WordSeek; `/newword` is a WordSeek alias) |
| `/join` | everyone | Join the running game |
| `/startuno` | everyone | Deal the first hands (min 2 players) |
| `/leave` | players | Leave the game |
| `/skip` | players | Skip the current player (fast mode) |
| `/kill` | creator / admin | Terminate the game |
| `/kick` | creator / admin | Kick a player (reply to them) |
| `/close`, `/open` | creator | Close / open the lobby |
| `/notifyme` (`/notify_me`) | everyone | PM when a new game starts in this group |
| `/modes` | everyone | Explain Classic / Fast / Wild |
| `/unostats` (`… reset`) | everyone | Show or reset your UNO stats |

Gameplay is inline: after `/startuno` type the bot username (or tap
**Make your choice**) to see your cards, draw/pass/call-bluff options, and
colour pickers.  Fast mode auto-skips slow players via an asyncio countdown.
Cards render as text + colour emoji (the original sticker file_ids only work
for that specific bot).  `/start select` in private picks which group's game
to act in when you play in several groups at once.

### Merged behaviour
- `/help` is the Pi-style interactive menu: one message edited in place, seven
  modules (Word Guess / WordSeek / UNO / Scores / Group / Other / Admin) with a
  shared paginator, rendered as Rich Messages with an automatic HTML fallback.
- `/score` is smart: with no active Word Guess game it shows WordSeek scores; during a Word Guess game it shows the ranking.
- `/stats` shows Shadow stats **plus** WordSeek counts (players, groups, words).
- `/start` in private uses the rich → HTML → plain ladder (start screen with
  menu + coloured keyboard); `/start help` opens the interactive help menu;
  `/start select` opens the UNO multi-group picker.
- `/gban`/`/ungban` are shared: banned users are blocked in both games.
- Top-level menu has 16 commands (`setMyCommands` at startup).

## Rich Messages & premium emoji (ported from Pi)

The bot ships a full Rich Messages layer (Bot API 10.1+) built on aiogram 3.21,
which predates the feature. Instead of upgrading aiogram, the two raw methods
are declared locally (`shadow_game_bot/rich.py`) as `TelegramMethod` subclasses;
they ride through aiogram's form-data serialisation untouched.

### Modules

| Module | Role |
|---|---|
| `emojis.py` | Owner's 33 premium custom emojis. `E.*` → HTML `<tg-emoji>` markup for message bodies; `EID.*` → raw ids for `icon_custom_emoji_id` on buttons; `plain()` strips all markup for callback-query toasts (no parse_mode). |
| `rich.py` | Raw `SendRichMessage` / `EditRichMessage` methods + every builder: RichText (`bold`/`italic`/`code`/`link`/`custom_emoji`), RichBlock (`heading`/`paragraph`/`table`/`list`/`details`/`buttons`), `html_to_rich`, `validate`, `unstyle`, `has_styled_buttons`. |
| `richsend.py` | Fallback ladder: styled rich → unstyled rich → caller's HTML. `RICH_ENABLED` kill switch; `build_blocks()` returns `None` on builder/validation failure. |
| `reply.py` | PTB-faithful reply helpers (reply-to iff group, `answer` in private) with automatic HTML promotion when the payload carries `<tg-emoji>`/`<b>`/`<i>`/`<code>`/`<blockquote>`. |
| `keyboards/colored.py` | `btn_primary` (blue) / `btn_success` (green) / `btn_danger` (red) / `btn_url` — each accepts `style=` and `icon_emoji_id=` (premium custom emoji). |

### Failure ladder

Rich is a strict upgrade, never a requirement:

1. Blocks with styled + iconed buttons (`sendRichMessage` / `editMessageText`).
2. Same blocks with button styles stripped (a 10.3-only field).
3. The caller's HTML fallback — exactly what the bot shipped before.

Every builder **raises** on failure; `richsend` catches and steps down. A bot
API server that rejects the whole rich body simply gets the HTML message.

### /start and /help

- **Private `/start`**: rich ladder (full start screen + 2-1-2 coloured
  keyboard) → command message deleted → DB + log. Group `/start` keeps the
  Word Guess mode-selection / scoreboard flow with branded replies.
- **`/help`**: one message, six modules, shared paginator. Rich renderer uses
  headings, a real table for the command grid and in-message buttons; HTML
  renderer is the automatic fallback. Callback data: `help:<action>:<args>`.
- **Group `/help`**: same menu with a DM-redirect button (deep link
  `?start=help`).

### Callback prefixes

| Prefix | Router |
|---|---|
| `help:` | interactive help menu (`handlers/menu.py`) |
| `start:` | start-screen callbacks (`handlers/start.py`) |
| `ws:` | WordSeek callbacks (`handlers/ws_callbacks.py`) |
| `sgb:` | Word Guess callbacks (`handlers/callbacks.py`) |

## Architecture notes (aiogram 3)

- **Package**: stays `shadow_game_bot`; entry point `run.py` → `shadow_game_bot.bot.main`.
- **Routers, in registration order** (first matching handler wins):
  `commands` (TextCommand filters) · `callbacks` (`ws:*` then `sgb:` prefix) ·
  `private text` (NonCommand) · `group text` (NonCommand).
- **Side-effect middlewares** (replicate the original grammY/PTB "run for every update"
  behaviour, *before* filters): user/chat sync → anti-cheat → tracking
  (messages, edits, button clicks, `chat_member` + `my_chat_member`). They are registered
  on `dp.message`, `dp.edited_message` and `dp.callback_query` as **outer** middlewares.
- **Allowed updates** are computed from the dispatcher's used update types plus an
  explicit `edited_message` (middlewares alone don't register it) — helper
  `resolve_allowed_updates(dp)`.
- **Command filters**: `TextCommand(Command)` matches only real text commands with a
  `bot_command` entity (PTB `filters.COMMAND` parity — caption commands do not fire).
  Handlers that need arguments receive a parsed `CommandObject` (`command.args`).
- **Callback edits** use `query.message.edit_text(...)` — aiogram's `CallbackQuery`
  has no `edit_message_text` shortcut.
- **Errors**: a single `error_handler` on `dp.errors` mirrors the original
  `error-handler.ts` (topic-recreation on "message thread not found", safe logging).
- **Message routing**: group → WordSeek game first (chat + topic match), otherwise Word
  Guess; private → Daily WordSeek session first, otherwise Shadow's DM word workflow.
- **Redis → TTL store**: votes (300 s), captcha (80/60 s), daily sessions (24 h), greeting
  counters (48 h). Broadcast state and anti-cheat tracking persist in SQLite
  (`ws_broadcast_state`, `ws_tracking`) so they survive restarts.
- **Daily word**: bit-exact port of the original — HMAC-SHA256 secret seed, mulberry32 PRNG,
  Fisher–Yates over `data/daily-word-lists.json`, 6 AM `TIME_ZONE` rollover.
- **Topic expiry**: `/recreatetopic on` stores the setting; on "message thread not found"
  errors the bot recreates the topic (name/icon preserved, tracked via topic rename events)
  exactly like the original `error-handler.ts`.
- **Inactivity**: Word Guess auto-ends after `INACTIVITY_TIMEOUT`; a background task checks it.
- **Broadcast**: owner messages are sent to tracked chats with a 10 s delay, progress edits
  every 50 sends; the run is persisted and resumes automatically after a restart.
- **Startup**: `on_startup` wires the app context, restores the pending broadcast, seeds the
  word pool (1058 words), ensures today's daily word, pushes the 16-command menu, and starts
  the daily-wordle + inactivity background tasks.

## Tests

```bash
python -m tests.test_logic      # 13 unit tests: PRNG/HMAC, word selection, scoring,
                                # TTL store, parsing, fancy text, sanitization, sessions
python tests\test_post_init.py  # integration: temp-copy boot — schema, word seeding,
                                # daily word, command menu, task wiring
python tests\test_routing.py    # routing + execution audit: real updates through real
                                # handlers (zero errors, expected API/DB effects) plus a
                                # handler-identity matrix for commands, callbacks,
                                # private/group text and negative cases (caption
                                # commands, unknown commands/prefixes → no handler)
python tests\test_rich.py       # rich/emoji system: E.* markup + plain() stripping,
                                # rich builders + validate limits, html_to_rich,
                                # styled→unstyled→HTML fallback ladder (stub bot),
                                # reply quote semantics + HTML auto-promotion,
                                # coloured/iconed keyboards, menu start/help builders
```

All four suites must print `PASS` (Telegram I/O is fully mocked — no network, no token
needed).

## Known gaps / notes

- Tracking covers messages, edits, button clicks and both `chat_member` /
  `my_chat_member` events. The original WordSeek also tracked `channel_post` and
  `inline_query` — these are **not** handled in the merged bot (neither were they in
  the earlier PTB build).
- All WordSeek words must match `^[a-z]{4,6}$`; groups are enforced with soft commands
  (`/new4` → 4-letter game).
- `data/` is required at runtime (word lists, daily rotation, banner image).
