export const OPPORTUNITIES_CHANGED = 'opportunities-changed';

export function notifyOpportunitiesChanged() {
  window.dispatchEvent(new CustomEvent(OPPORTUNITIES_CHANGED));
}

export function onOpportunitiesChanged(handler: () => void) {
  window.addEventListener(OPPORTUNITIES_CHANGED, handler);
  return () => window.removeEventListener(OPPORTUNITIES_CHANGED, handler);
}
