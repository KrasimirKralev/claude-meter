/* Shared by every window: applies the app theme to the page, and small DOM helpers. Safe DOM only. */
(function(global) {
  'use strict';

  var DARK_THEMES = { dark: true, nord: true, dracula: true };
  // Colour on the accent, for themes whose accent is too dark for ink.
  var ON_ACCENT = { karchx: '#ffffff', light: '#ffffff' };

  function applyTheme(theme) {
    if (!theme) return;
    var root = document.documentElement;
    var set = function(name, value) { if (value) root.style.setProperty(name, value); };
    set('--bg', theme.winBg || theme.bg);
    set('--surface', theme.surface);
    set('--surface2', theme.surface2);
    set('--border', theme.border);
    set('--text', theme.text);
    set('--text-dim', theme.textDim);
    set('--ink', theme.text);
    set('--accent', theme.accent);
    set('--on-accent', ON_ACCENT[theme.name] || '#111111');
    set('--green', theme.green);
    set('--red', theme.red);
    set('--yellow', theme.yellow);
    set('--bar-bg', theme.barBg);
    // Brutal's red is too light for small text on white. Other themes keep their own.
    set('--crit-text', theme.name === 'brutal' ? '#c8232b' : (theme.red || '#e5484d'));
    set('--hover', DARK_THEMES[theme.name] ? 'rgba(255, 255, 255, 0.08)' : 'rgba(17, 17, 17, 0.06)');
    root.dataset.theme = theme.name || 'brutal';
    root.style.colorScheme = DARK_THEMES[theme.name] ? 'dark' : 'light';
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  var ICONS = {
    close: 'm7 7 10 10M17 7 7 17',
    check: 'm5 12.5 4.5 4.5L19 7.5',
    plus: 'M12 5v14M5 12h14',
    prev: 'm15 6-6 6 6 6',
    next: 'm9 6 6 6-6 6',
    down: 'm6 9 6 6 6-6',
    grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
    calendar: 'M7 4v3M17 4v3M4.5 9.5h15M6 6h12a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 18 20H6a1.5 1.5 0 0 1-1.5-1.5v-11A1.5 1.5 0 0 1 6 6Z',
    note: 'M7 4h7l4 4v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM14 4v4h4M9 13h6M9 16.5h4',
    trash: 'M5 7h14M10 7V5h4v2M7 7l1 12.5h8L17 7',
    edit: 'M5 19l1-4L16 5l3 3L9 18l-4 1Z',
    link: 'M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4',
    bell: 'M7 16V11a5 5 0 0 1 10 0v5l1.5 2h-13L7 16ZM10.5 20.5h3',
    repeat: 'M17 4l3 3-3 3M20 7H8a4 4 0 0 0-4 4M7 20l-3-3 3-3M4 17h12a4 4 0 0 0 4-4',
  };

  function icon(name) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS(ns, 'path');
    path.setAttribute('d', ICONS[name] || '');
    svg.appendChild(path);
    return svg;
  }

  function iconButton(name, label, cls) {
    var button = el('button', 'icon-btn' + (cls ? ' ' + cls : ''));
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.appendChild(icon(name));
    return button;
  }

  global.UI = { applyTheme: applyTheme, el: el, clear: clear, icon: icon, iconButton: iconButton };
})(window);
