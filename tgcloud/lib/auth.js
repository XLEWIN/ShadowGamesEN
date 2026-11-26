// Authorization: privileged actions are restricted to an explicit ID whitelist.
import { OWNER_ID } from './texts.js';

const EXTRA_ADMINS = new Set([8301883098].filter(Number.isSafeInteger));

export function isAdmin(userId) {
  const id = Number(userId);
  return Number.isSafeInteger(id) && (id === OWNER_ID || EXTRA_ADMINS.has(id));
}

export function adminLabel(userId) {
  return isAdmin(userId) ? 'admin' : 'user';
}
