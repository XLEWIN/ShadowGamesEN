// /start screen: rich blocks + colored HTML keyboard — port of handlers/menu.py

import {
  heading, paragraph, divider, buttonsBlock, button,
} from './rich.js';
import { btnUrl, btnPrimary, buildKeyboard } from './keyboards.js';
import { E, EID } from './emojis.js';
import { htmlToRich } from './rich.js';
import {
  URL_ADD_TO_GROUP, URL_OWNER, URL_UPDATES, URL_DISCUSSION,
  START_TITLE_LINE, START_HINT_LINE, BOT_DESCRIPTION,
} from './texts.js';

export function buildStartBlocks(username) {
  return [
    heading(htmlToRich(START_TITLE_LINE(E.FIRE, `@${username}`)), 2),
    paragraph(htmlToRich(BOT_DESCRIPTION)),
    paragraph(htmlToRich(START_HINT_LINE(E.ARROW))),
    divider(),
    buttonsBlock([
      button('Add me to a group', { url: URL_ADD_TO_GROUP(username), style: 'success', icon: E.ADD }),
      button('Help Menu', { callback_data: 'start:help', style: 'primary', icon: E.INFO }),
    ], 'center'),
    buttonsBlock([
      button('Owner', { url: URL_OWNER, style: 'danger', icon: E.CROWN }),
    ], 'center'),
    buttonsBlock([
      button('Official Channel', { url: URL_UPDATES, style: 'primary', icon: E.ANNOUNCE }),
      button('Support Chat', { url: URL_DISCUSSION, style: 'primary', icon: E.INFO }),
    ], 'center'),
  ];
}

export function buildStartKeyboard(username, icons = true) {
  return buildKeyboard([
    [
      btnUrl('Add me to a group', URL_ADD_TO_GROUP(username), icons ? EID.ADD : null, 'success'),
      btnPrimary('Help Menu', 'start:help', icons ? EID.INFO : null),
    ],
    [
      btnUrl('Owner', URL_OWNER, icons ? EID.CROWN : null, 'primary'),
    ],
    [
      btnUrl('Official Channel', URL_UPDATES, icons ? EID.ANNOUNCE : null, 'primary'),
      btnUrl('Support Chat', URL_DISCUSSION, icons ? EID.INFO : null, 'primary'),
    ],
  ]);
}
