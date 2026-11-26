// /help screen — rich blocks with premium emoji and styled inline buttons.
import { heading, paragraph, divider, buttonsBlock, button, htmlToRich } from './rich.js';
import { E } from './emojis.js';
import { BOT_USERNAME, HUB_URL, LUDO_URL, CHESS_URL, URL_OWNER, URL_DISCUSSION } from './texts.js';

export function helpHtml() {
  return `${E.INFO} <b>Shadow Games — Commands</b>\n${E.BULLET}\n\n` +
    `${E.GAME} <b>Board games</b>\n` +
    `<code>/ludo</code> Ludo · <code>/chess</code> Chess · <code>/games</code> Hub\n\n` +
    `${E.TROPHY} <b>Group games</b>\n` +
    `<code>/game</code> Shadow Word · <code>/new</code> WordSeek · <code>/newuno</code> UNO\n` +
    `<code>/new4 /new5 /new6</code> WordSeek lengths · <code>/daily</code> daily puzzle\n` +
    `<code>/leaderboard</code> scores · <code>/ranking</code> rankings\n\n` +
    `${E.PLAY} <b>UNO</b>\n` +
    `<code>/join</code> join · <code>/startuno</code> deal · <code>/modes</code> modes\n\n` +
    `${E.SETTINGS} <b>More</b>\n` +
    `<code>/settings</code> profile · <code>/rules</code> rules · <code>/id</code> info · <code>/help</code> menu`;
}

export function buildHelpBlocks() {
  return [
    heading(htmlToRich(`${E.INFO} <b>Shadow Games — Commands</b>`), 2),
    paragraph(htmlToRich(
      `${E.GAME} <b>Board games</b>\n` +
      `<code>/ludo</code> Ludo · <code>/chess</code> Chess · <code>/games</code> Hub\n\n` +
      `${E.TROPHY} <b>Group games</b>\n` +
      `<code>/game</code> Shadow Word · <code>/new</code> WordSeek · <code>/newuno</code> UNO\n` +
      `<code>/new4 /new5 /new6</code> lengths · <code>/daily</code> daily puzzle\n` +
      `<code>/leaderboard</code> scores · <code>/ranking</code> rankings\n\n` +
      `${E.PLAY} <b>UNO</b>\n` +
      `<code>/join</code> join · <code>/startuno</code> deal · <code>/modes</code> modes\n\n` +
      `${E.SETTINGS} <b>More</b>\n` +
      `<code>/settings</code> profile · <code>/rules</code> rules · <code>/id</code> info`
    )),
    divider(),
    buttonsBlock([
      button('Games Hub', { url: HUB_URL, style: 'primary', icon: E.GAME }),
      button('Ludo', { url: LUDO_URL, style: 'success', icon: E.PLAY }),
      button('Chess', { url: CHESS_URL, style: 'primary', icon: E.CROWN }),
    ], 'center'),
    buttonsBlock([
      button('Add me to a group', {
        url: `https://t.me/${BOT_USERNAME}?startgroup=true`, style: 'success', icon: E.ADD,
      }),
    ], 'center'),
    buttonsBlock([
      button('Owner', { url: URL_OWNER, style: 'danger', icon: E.CROWN }),
      button('Support', { url: URL_DISCUSSION, style: 'primary', icon: E.INFO }),
    ], 'center'),
  ];
}
