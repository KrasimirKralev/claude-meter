/* Shared by every window: applies the app theme to the page, and small DOM helpers. Safe DOM only. */
(function(global) {
  'use strict';

  var DARK_THEMES = { dark: true, nord: true, dracula: true };

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
    set('--ink', theme.line || theme.text);
    set('--shadow-color', theme.shadow || theme.line || theme.text);
    set('--accent', theme.accent);
    set('--on-accent', theme.onAccent || '#111111');
    set('--green', theme.green);
    set('--red', theme.red);
    set('--yellow', theme.yellow);
    set('--bar-bg', theme.barBg);
    set('--crit-text', theme.critText || theme.red || '#e5484d');
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
    minus: 'M6 12h12',
    help: 'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17ZM9.6 9.7a2.5 2.5 0 1 1 3.7 2.2c-.8.4-1.3 1-1.3 1.8M12 16.8h.01',
    share: 'M12 15V4.5M8 8.5l4-4 4 4M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14',
    copy: 'M10 9h8.5a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H10a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 10 9ZM5.5 15A1.5 1.5 0 0 1 4 13.5v-8A1.5 1.5 0 0 1 5.5 4H14a1.5 1.5 0 0 1 1.5 1.5',
    alarm: 'M12 6a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM12 9.5V13l2.5 1.5M5 3.5 2.5 6M19 3.5 21.5 6',
    bolt: 'M13 3 5 14h6l-1 7 8-11h-6l1-7Z',
    sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4',
    moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z',
    clipboard: 'M9 4h6v3H9V4ZM9 5.5H7A1.5 1.5 0 0 0 5.5 7v12A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V7A1.5 1.5 0 0 0 17 5.5h-2M9 12h6M9 16h4',
    warning: 'M12 4 2.5 20h19L12 4ZM12 10v4.5M12 17.5h.01',
    video: 'M4.5 7h10a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1ZM15.5 11l5-3v8l-5-3',
    coffee: 'M5 9h12v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V9ZM17 10.5h1.5a2.5 2.5 0 0 1 0 5H17M8.5 3.5V6M12.5 3.5V6',
    target: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z',
    star: 'm12 4 2.5 5.2 5.7.8-4.1 4 1 5.7L12 17l-5.1 2.7 1-5.7-4.1-4 5.7-.8L12 4Z',
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
