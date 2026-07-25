import { icon, hydrateIcons } from './icons.js';

export { icon, hydrateIcons };
export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export const escapeHTML = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
export const formatNumber = (value = 0) => new Intl.NumberFormat('en', { notation: Number(value) >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(Number(value) || 0);
export const formatBytes = (bytes = 0) => bytes ? `${(bytes / 1024 / 1024).toFixed(bytes > 1024 ** 3 ? 1 : 0)} ${bytes > 1024 ** 3 ? 'GB' : 'MB'}` : '0 MB';
export const timeAgo = (value) => {
  if (!value) return '—';
  const seconds = Math.floor((Date.now() - new Date(value).getTime()) / 1000);
  const units = [['year',31536000],['month',2592000],['day',86400],['hour',3600],['minute',60]];
  for (const [unit, size] of units) if (Math.abs(seconds) >= size) return new Intl.RelativeTimeFormat('en',{numeric:'auto'}).format(-Math.floor(seconds/size),unit);
  return 'just now';
};
export const dateText = (value) => value ? new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(value)) : '—';
export const debounce = (fn, wait = 200) => { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); }; };

export function toast(message, type = 'success', title) {
  const region = $('#toastRegion');
  if (!region) return;
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  const iconName = type === 'error' ? 'alert-triangle' : type === 'warning' ? 'info' : 'check-circle';
  node.innerHTML = `${icon(iconName)}<span><b>${escapeHTML(title || (type === 'error' ? 'Action failed' : type === 'warning' ? 'Heads up' : 'Success'))}</b><small>${escapeHTML(message)}</small></span><button aria-label="Dismiss">${icon('x')}</button>`;
  node.querySelector('button').onclick = () => node.remove();
  region.append(node);
  setTimeout(() => node.remove(), 5200);
}

export function buttonLoading(button, loading, label = 'Working...') {
  if (!button) return;
  if (loading) {
    button.dataset.original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="button-spinner">${icon('refresh-cw')}</span><span>${escapeHTML(label)}</span>`;
  } else {
    button.disabled = false;
    if (button.dataset.original) button.innerHTML = button.dataset.original;
  }
}

export function hideLoader(delay = 350) {
  setTimeout(() => $('#loadingScreen')?.classList.add('loaded'), delay);
}

export function setProgress(element, percent) {
  if (element) element.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

export function copyText(text, success = 'Copied to clipboard.') {
  return navigator.clipboard.writeText(text).then(() => toast(success)).catch(() => toast('Clipboard access was blocked.', 'error'));
}
