export const tg = (typeof window !== 'undefined' && window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;

export function tgReady() {
  if (!tg) return;
  try {
    tg.ready(); tg.expand();
    tg.disableVerticalSwipes && tg.disableVerticalSwipes();
    tg.setHeaderColor && tg.setHeaderColor('#05070f');
    tg.setBackgroundColor && tg.setBackgroundColor('#05070f');
  } catch (e) { /* not in Telegram */ }
}

export function tgName() {
  try {
    const u = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
    return u ? (u.first_name || 'You') : 'You';
  } catch (e) {
    return 'You';
  }
}

export function tgPhoto() {
  try {
    const u = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
    return (u && u.photo_url) || null;
  } catch (e) {
    return null;
  }
}

export function haptic(kind) {
  try { tg && tg.HapticFeedback && tg.HapticFeedback.impactOccurred(kind || 'light'); } catch (e) { }
}

export function backButton(onBack, visible = true) {
  try {
    if (!tg || !tg.BackButton) return;
    if (!visible) { tg.BackButton.hide(); return; }
    tg.BackButton.show();
    tg.BackButton.onClick(onBack);
  } catch (e) { /* not in Telegram */ }
}
