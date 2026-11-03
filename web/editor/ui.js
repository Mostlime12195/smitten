// Small UI toolkit: element builder, icons, dialogs, menus and toasts.

import { ICONS } from './icons.js';

/** h('div', {class: 'x', onclick}, child, 'text', ...) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}


/** A Lucide icon (icons.js; add names in tools/gen-icons.mjs). */
export function icon(name, size = 16) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  return span;
}

/** Replace [data-icon] placeholders in static markup with SVG icons. */
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    el.prepend(icon(el.dataset.icon, Number(el.dataset.iconSize) || 16));
    el.removeAttribute('data-icon');
  }
}

// ---------------------------------------------------------------------------
// Dialogs

/**
 * Show a modal dialog. Resolves with the value of the clicked action, or
 * null when dismissed (Escape / backdrop / close button).
 */
export function openDialog({ title, body, actions = [], className = '', onOpen, initialFocus, wide = false }) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: `dialog ${wide ? 'wide' : ''} ${className}`, 'aria-label': title });
    const form = h('form', { method: 'dialog' });
    const closeBtn = h('button', { type: 'button', class: 'icon-btn dialog-close', title: 'Close', 'aria-label': 'Close' }, icon('x'));
    const header = h('div', { class: 'dialog-header' }, h('h2', {}, title), closeBtn);
    const content = h('div', { class: 'dialog-body' }, body);
    form.append(header, content);
    let result = null;
    const finish = (value) => {
      result = value;
      dlg.close();
    };
    if (actions.length) {
      const footer = h('div', { class: 'dialog-footer' });
      for (const a of actions) {
        const btn = h('button', {
          type: a.submit ? 'submit' : 'button',
          class: `btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''} ${a.ghost ? 'ghost' : ''}`,
          value: a.value,
        }, a.label);
        btn.addEventListener('click', (e) => {
          if (a.submit) return; // handled by submit
          e.preventDefault();
          if (a.validate && !a.validate()) return;
          finish(a.value);
        });
        if (a.left) btn.classList.add('left');
        footer.append(btn);
      }
      form.append(footer);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const submitAction = actions.find((a) => a.submit);
        if (!submitAction) return;
        if (submitAction.validate && !submitAction.validate()) return;
        finish(submitAction.value);
      });
    }
    closeBtn.addEventListener('click', () => finish(null));
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) finish(null); // backdrop
    });
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(result);
    });
    dlg.append(form);
    document.body.append(dlg);
    dlg.showModal();
    dlg.finish = finish;
    onOpen?.(dlg, finish);
    (initialFocus ? dlg.querySelector(initialFocus) : null)?.focus();
  });
}

export async function promptDialog({ title, label, value = '', okLabel = 'OK', placeholder = '', validate, selectBase = false }) {
  const input = h('input', { type: 'text', class: 'input', value, placeholder, spellcheck: 'false', autocomplete: 'off', 'aria-label': label || title });
  const error = h('div', { class: 'field-error', role: 'alert' });
  const check = () => {
    const msg = validate ? validate(input.value.trim()) : (input.value.trim() ? '' : 'Please enter a name.');
    error.textContent = msg || '';
    return !msg;
  };
  input.addEventListener('input', () => { error.textContent = ''; });
  const body = h('div', { class: 'field' }, label ? h('label', {}, label) : null, input, error);
  const res = await openDialog({
    title,
    body,
    actions: [
      { label: 'Cancel', value: null, ghost: true },
      { label: okLabel, value: 'ok', primary: true, submit: true, validate: check },
    ],
    onOpen: () => {
      input.focus();
      if (selectBase) {
        const dot = value.lastIndexOf('.');
        const slash = value.lastIndexOf('/');
        input.setSelectionRange(slash + 1, dot > slash + 1 ? dot : value.length);
      } else input.select();
    },
  });
  return res === 'ok' ? input.value.trim() : null;
}

export async function confirmDialog({ title, message, okLabel = 'OK', danger = false, cancelLabel = 'Cancel' }) {
  const res = await openDialog({
    title,
    body: h('p', { class: 'dialog-message' }, message),
    actions: [
      { label: cancelLabel, value: null, ghost: true },
      { label: okLabel, value: 'ok', primary: !danger, danger, submit: true },
    ],
    initialFocus: 'button[type=submit]',
  });
  return res === 'ok';
}

// ---------------------------------------------------------------------------
// Context menus

let openMenu = null;

export function closeMenu() {
  if (openMenu) {
    openMenu.remove();
    openMenu = null;
  }
}

/**
 * items: [{label, icon, shortcut, action, danger, disabled} | '-']
 * anchor: {x, y} or an element (menu opens below it).
 */
export function showMenu(anchor, items) {
  closeMenu();
  const menu = h('div', { class: 'menu', role: 'menu' });
  const buttons = [];
  for (const item of items) {
    if (item === '-') {
      menu.append(h('div', { class: 'menu-sep', role: 'separator' }));
      continue;
    }
    if (item.heading) {
      menu.append(h('div', { class: 'menu-heading' }, item.heading));
      continue;
    }
    const btn = h('button', {
      type: 'button',
      class: `menu-item ${item.danger ? 'danger' : ''}`,
      role: 'menuitem',
      disabled: item.disabled,
    }, item.icon ? icon(item.icon) : h('span', { class: 'icon' }), h('span', { class: 'menu-label' }, item.label),
    item.shortcut ? h('kbd', {}, item.shortcut) : null);
    btn.addEventListener('click', () => {
      closeMenu();
      item.action?.();
    });
    buttons.push(btn);
    menu.append(btn);
  }
  document.body.append(menu);
  openMenu = menu;
  let x, y;
  if (anchor instanceof Element) {
    const r = anchor.getBoundingClientRect();
    x = r.left;
    y = r.bottom + 4;
    if (x + menu.offsetWidth > innerWidth - 8) x = r.right - menu.offsetWidth;
  } else ({ x, y } = anchor);
  x = Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8));
  y = Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8));
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  buttons.find((b) => !b.disabled)?.focus();
  menu.addEventListener('keydown', (e) => {
    const i = buttons.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); buttons[(i + 1) % buttons.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length].focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeMenu(); }
  });
  return menu;
}

document.addEventListener('pointerdown', (e) => {
  if (openMenu && !openMenu.contains(e.target)) closeMenu();
}, true);
window.addEventListener('blur', closeMenu);
window.addEventListener('resize', closeMenu);

// ---------------------------------------------------------------------------
// Toasts

export function toast(message, { type = 'info', timeout = 3200 } = {}) {
  const host = document.getElementById('toasts');
  const iconName = { error: 'alert', success: 'check', info: 'info' }[type] || 'info';
  const el = h('div', { class: `toast ${type}`, role: type === 'error' ? 'alert' : 'status' }, icon(iconName), h('span', {}, message));
  host.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, timeout);
}

// ---------------------------------------------------------------------------
// Misc helpers

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function timeAgo(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const hrs = Math.round(m / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const d = Math.round(hrs / 24);
  if (d < 30) return `${d} d ago`;
  return new Date(t).toLocaleDateString();
}

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const modKey = isMac ? '⌘' : 'Ctrl';
