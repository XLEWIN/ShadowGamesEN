import { table, integer, text, real, boolean, json, sql, index, uniqueIndex, primaryKey } from 'sdk/db';

// ShadowgameBot tables (original)
export const games = table('games', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chatId: integer('chat_id').notNull(),
  chatName: text('chat_name'),
  category: text('category').default('normal'),
  gameActive: integer('game_active').notNull().default(1),
  currentLeaderId: integer('current_leader_id'),
  currentRoundId: integer('current_round_id'),
  leaderMessageId: integer('leader_message_id'),
  leaderSelectionMessageId: integer('leader_selection_message_id'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (t) => ({ byChatActive: index('idx_games_chat_active').on(t.chatId, t.gameActive) }));

export const rounds = table('rounds', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  gameId: integer('game_id').notNull(),
  word: text('word').notNull(),
  leaderId: integer('leader_id').notNull(),
  status: text('status').notNull().default('ACTIVE'),
  startedAt: text('started_at').default(sql`(datetime('now'))`),
  endedAt: text('ended_at'),
  winnerId: integer('winner_id'),
}, (t) => ({ byGameStatus: index('idx_rounds_game_status').on(t.gameId, t.status) }));

export const gamePlayers = table('game_players', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  gameId: integer('game_id').notNull(),
  userId: integer('user_id').notNull(),
  displayName: text('display_name').notNull().default('Unknown'),
  username: text('username'),
  score: integer('score').notNull().default(0),
  wordsGuessed: integer('words_guessed').notNull().default(0),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (t) => ({
  uniqueGameUser: uniqueIndex('uq_game_players_game_user').on(t.gameId, t.userId),
  byGame: index('idx_players_game').on(t.gameId),
  byGameScore: index('idx_players_game_score').on(t.gameId, t.score),
  byUser: index('idx_players_user').on(t.userId),
}));

export const words = table('words', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  word: text('word').notNull(),
  normalized: text('normalized').notNull().unique(),
  active: integer('active').notNull().default(1),
  category: text('category'),
  difficulty: text('difficulty'),
  language: text('language').default('en'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

export const usedWords = table('used_words', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  gameId: integer('game_id').notNull(),
  wordNormalized: text('word_normalized').notNull(),
  usedAt: text('used_at').default(sql`(datetime('now'))`),
}, (t) => ({ uniqueGameWord: uniqueIndex('uq_used_words_game_word').on(t.gameId, t.wordNormalized) }));

export const dmActions = table('dm_actions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  gameChatId: integer('game_chat_id').notNull(),
  action: text('action').notNull(),
  gameId: integer('game_id'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
}, (t) => ({ byUser: index('idx_dm_actions_user').on(t.userId) }));

export const userStartedBot = table('user_started_bot', {
  userId: integer('user_id').primaryKey(),
  startedAt: text('started_at').default(sql`(datetime('now'))`),
});

export const gbannedUsers = table('gbanned_users', {
  userId: integer('user_id').primaryKey(),
  bannedAt: text('banned_at').default(sql`(datetime('now'))`),
  reason: text('reason'),
});

// WordSeek tables (ported from Postgres to SQLite)
export const wsUsers = table('ws_users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  username: text('username'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
});

export const wsLeaderboard = table('ws_leaderboard', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  chatId: text('chat_id').notNull(),
  score: integer('score').notNull(),
  wordLength: text('word_length').notNull().default('5'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (t) => ({
  byUser: index('idx_ws_leaderboard_user').on(t.userId),
  byChat: index('idx_ws_leaderboard_chat').on(t.chatId),
  byLen: index('idx_ws_leaderboard_len').on(t.wordLength),
}));

export const wsGames = table('ws_games', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  word: text('word').notNull(),
  activeChat: text('active_chat').notNull(),
  topicId: text('topic_id').notNull().default('general'),
  startedBy: text('started_by'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (t) => ({ uniqueChatTopic: uniqueIndex('idx_ws_games_chat_topic').on(t.activeChat, t.topicId) }));

export const wsGuesses = table('ws_guesses', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  guess: text('guess').notNull(),
  gameId: integer('game_id').notNull(),
  chatId: text('chat_id').notNull(),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (t) => ({ byGame: index('idx_ws_guesses_game').on(t.gameId) }));

export const wsAuthorizedUsers = table('ws_authorized_users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chatId: text('chat_id'),
  userId: text('user_id'),
  authorizedBy: text('authorized_by'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
}, (t) => ({ uniqueChatUser: uniqueIndex('uq_ws_authorized_chat_user').on(t.chatId, t.userId) }));

export const wsChatGameTopics = table('ws_chat_game_topics', {
  chatId: text('chat_id').notNull(),
  topicId: text('topic_id').notNull(),
  name: text('name'),
  iconCustomEmojiId: text('icon_custom_emoji_id'),
  shouldRecreateOnExpire: integer('should_recreate_on_expire').notNull().default(0),
  allowedLengths: text('allowed_lengths').notNull().default('5,4,6'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (t) => ({ pk: primaryKey({ columns: [t.chatId, t.topicId] }) }));

export const wsBroadcastChats = table('ws_broadcast_chats', {
  id: text('id').primaryKey(),
  name: text('name'),
  username: text('username'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
});

export const wsUserStats = table('ws_user_stats', {
  userId: text('user_id').primaryKey(),
  highestStreak: integer('highest_streak').notNull().default(0),
  currentStreak: integer('current_streak').notNull().default(0),
  lastGuessed: text('last_guessed'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
});

export const wsDailyWords = table('ws_daily_words', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  dayNumber: integer('day_number').notNull().unique(),
  word: text('word').notNull(),
  date: text('date').notNull().unique(),
  meaning: text('meaning'),
  phonetic: text('phonetic'),
  sentence: text('sentence'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
});

export const wsDailyGuesses = table('ws_daily_guesses', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  dailyWordId: integer('daily_word_id').notNull(),
  guess: text('guess').notNull(),
  attemptNumber: integer('attempt_number').notNull(),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (t) => ({ byUserWord: index('idx_ws_daily_guesses_user').on(t.userId, t.dailyWordId) }));

export const wsWordHistory = table('ws_word_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chatId: text('chat_id').notNull(),
  wordLength: integer('word_length').notNull(),
  word: text('word').notNull(),
  usedAt: text('used_at').default(sql`(datetime('now'))`),
}, (t) => ({
  uniqueChatLenWord: uniqueIndex('uq_ws_word_history_chat_len_word').on(t.chatId, t.wordLength, t.word),
  byChat: index('idx_ws_word_history_chat').on(t.chatId, t.wordLength),
}));

export const wsBroadcastState = table('ws_broadcast_state', {
  id: integer('id').primaryKey(),
  state: text('state').notNull(),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
});

export const wsTracking = table('ws_tracking', {
  chatId: text('chat_id').primaryKey(),
  adminChatId: text('admin_chat_id').notNull(),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

export const botState = table('bot_state', {
  key: text('key').primaryKey(),
  value: json('value'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// Webapp game lobbies (Ludo / Chess) created from inline invites or the Mini App
export const webappLobbies = table('webapp_lobbies', {
  code: text('code').primaryKey(),
  game: text('game').notNull(),          // 'ludo' | 'chess'
  maxPlayers: integer('max_players').notNull().default(2),
  creatorId: integer('creator_id').notNull(),
  chatId: text('chat_id'),
  messageId: integer('message_id'),
  players: json('players').notNull().default([]),
  spectators: json('spectators').notNull().default([]),
  status: text('status').notNull().default('open'), // open | live | ended
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (t) => ({
  byChat: index('idx_webapp_lobbies_chat').on(t.chatId),
  byStatus: index('idx_webapp_lobbies_status').on(t.status),
}));

// UNO (mau mau) statistics
export const unoStats = table('uno_stats', {
  userId: integer('user_id').primaryKey(),
  gamesPlayed: integer('games_played').notNull().default(0),
  firstPlaces: integer('first_places').notNull().default(0),
  cardsPlayed: integer('cards_played').notNull().default(0),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
});
