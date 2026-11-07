/* Notes renderer — sticky board + markdown read/edit editor.
   Safe DOM only (no innerHTML). */

var stickyNotes = [];
var activeNoteId = null;
// The open note's text as last loaded or saved: what the editor's own changes are measured from.
// The phone and the watch now edit notes too (hub 1.6), so a change can arrive while one is open.
var openedText = null;
var currentTaskId = null;
var saveTimer = null;
var editing = false;
var boardQuery = '';
var refreshTimer = null;
var blockEditing = null;   // { el, ta, line } while a Read-view block is being edited inline

/* The page's mode, from the query string it was loaded with:
   none is the panel beside the widget, where minimise hides it;
   app is the standalone window (real minimise);
   embed is the same board as app, inside the dashboard's Plan section, with no window around it. */
var pageMode = new URLSearchParams(location.search).get('mode');
var isEmbedMode = pageMode === 'embed';
var isAppMode = pageMode === 'app' || isEmbedMode;
if (isEmbedMode) document.body.classList.add('mode-embed');

/* The note color keys in the data, the same on the phone and the watch. The paint is .c-<key> in notes.html. */
var COLORS = [
  { key: 'default', label: 'Plain' },
  { key: 'yellow',  label: 'Yellow' },
  { key: 'pink',    label: 'Pink' },
  { key: 'green',   label: 'Green' },
  { key: 'blue',    label: 'Blue' },
  { key: 'purple',  label: 'Purple' },
];

/* ---- element refs ---- */
var boardView   = document.getElementById('boardView');
var editorView  = document.getElementById('editorView');
var boardEl     = document.getElementById('board');
var noteCountEl = document.getElementById('noteCount');
var editorTitle = document.getElementById('editorTitle');
var md          = document.getElementById('md');
var rendered    = document.getElementById('rendered');
var renderOut   = document.getElementById('renderOut');
var wcEl        = document.getElementById('wc');
var savedChip   = document.getElementById('savedChip');
var colorPick   = document.getElementById('colorPick');
var helper      = document.getElementById('helper');
var panelOutline= document.getElementById('panelOutline');
var archivePanel= document.getElementById('archivePanel');
var boardSearch = document.getElementById('boardSearch');
var captureInput= document.getElementById('captureInput');
var captureBtn  = document.getElementById('captureBtn');
var slashMenu   = document.getElementById('slashMenu');
var rawPane     = document.getElementById('rawPane');
var edContent   = document.getElementById('edContent');
var readBtn     = document.getElementById('readBtn');
var editBtn     = document.getElementById('editBtn');
var backBtn     = document.getElementById('backBtn');
var helpBtn     = document.getElementById('helpBtn');
var archiveBtn  = document.getElementById('archiveBtn');
var liveStatus  = document.getElementById('liveStatus');
var boardScroll = 0;       // where the board was when a note was opened

/* The buttons written in notes.html get their icons here, so the paths live in one place. */
var STATIC_ICONS = {
  minBtnBoard: 'minus', closeBtnBoard: 'close', minBtnEd: 'minus', closeBtnEd: 'close',
  addNoteBtn: 'plus', archiveBtn: 'trash', backBtn: 'prev', helpBtn: 'help', shareBtn: 'share',
  helperClose: 'close',
};
Object.keys(STATIC_ICONS).forEach(function(id) {
  var button = document.getElementById(id);
  button.insertBefore(UI.icon(STATIC_ICONS[id]), button.firstChild);
});

/* ---- helpers ---- */
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function getActiveNote() { return stickyNotes.find(function(n) { return n.id === activeNoteId; }); }
function markPressed(button, on) {
  button.classList.toggle('on', on);
  button.setAttribute('aria-pressed', on ? 'true' : 'false');
}
// A colour key the data holds but this version doesn't know is shown as a plain note.
function colorKeyOf(note) {
  var key = note && note.color;
  return COLORS.some(function(c) { return c.key === key; }) ? key : 'default';
}
function scrollBehavior() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

/* Board title = first "# heading" of the note, else first non-empty line, else Untitled */
function noteTitle(note) {
  var text = note.text || '';
  var mh = text.match(/^#\s+(.+)$/m);
  if (mh) return mh[1].trim().slice(0, 46);
  if (note.title) return note.title.slice(0, 46);
  var first = text.split('\n').map(function(s){ return s.trim(); }).filter(Boolean)[0];
  return first ? first.replace(/^[#>\-*\s]+/, '').slice(0, 46) : 'Untitled';
}
function notePreview(note) {
  var lines = (note.text || '').split('\n');
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    if (i === 0 && /^#\s/.test(lines[i])) continue;   // skip the heading used as title
    var l = lines[i]
      .replace(/^#+\s/, '')
      .replace(/^>\s?/, '')
      .replace(/^-\s\[( |x)\]\s/, function(_, c){ return c === 'x' ? '✓ ' : '□ '; })
      .replace(/^[-*]\s/, '• ')
      .replace(/[`*]/g, '');
    out.push(l);
  }
  return out.join('\n').trim();
}

/* ============ TAGS ============ */
function extractTags(text) {
  var out = [], m;
  var re = /(^|\s)#([a-zA-ZЀ-ӿ][\wЀ-ӿ-]{1,19})/g;
  while ((m = re.exec(text || ''))) {
    var t = m[2].toLowerCase();
    if (out.indexOf(t) === -1) out.push(t);
  }
  return out;
}
function filteredNotes() {
  var q = (boardQuery || '').trim().toLowerCase();
  if (!q) return stickyNotes;
  if (q.charAt(0) === '#') {
    var tag = q.slice(1);
    return stickyNotes.filter(function(n){ return extractTags(n.text).indexOf(tag) !== -1; });
  }
  return stickyNotes.filter(function(n) {
    return (noteTitle(n) + ' ' + (n.text || '')).toLowerCase().indexOf(q) !== -1;
  });
}

/* ============ BOARD ============ */
function focusCard(id) {
  var open = boardEl.querySelector('.scard[data-id="' + CSS.escape(String(id)) + '"] .sc-open');
  if (open) open.focus();
  return Boolean(open);
}

function buildCard(note) {
  var colorKey = colorKeyOf(note);
  var title = noteTitle(note);
  var card = UI.el('div', 'scard c-' + colorKey + (colorKey === 'default' ? '' : ' candy'));
  card.setAttribute('data-id', String(note.id));

  var open = UI.el('button', 'sc-open');
  open.type = 'button';
  open.appendChild(UI.el('span', 'sc-title', title));
  open.addEventListener('click', function() { openEditor(note.id); });
  card.appendChild(open);

  var tags = extractTags(note.text);
  if (tags.length) {
    var tagRow = UI.el('div', 'sc-tags');
    tags.slice(0, 4).forEach(function(tag) {
      var chip = UI.el('button', 'tag sc-tag', '#' + tag);
      chip.type = 'button';
      chip.title = 'Filter by #' + tag;
      chip.addEventListener('click', function() {
        boardQuery = '#' + tag;
        boardSearch.value = boardQuery;
        renderBoard();
        boardSearch.focus();
      });
      tagRow.appendChild(chip);
    });
    card.appendChild(tagRow);
  }

  var preview = notePreview(note);
  card.appendChild(UI.el('div', 'sc-body' + (preview ? '' : ' is-empty'), preview || 'Empty note'));

  var meta = UI.el('div', 'sc-meta');
  meta.appendChild(UI.el('span', '', note.createdAt ? new Date(note.createdAt).toLocaleDateString() : ''));
  var del = UI.iconButton('trash', 'Delete note', 'danger sc-del');
  del.setAttribute('aria-label', 'Delete note: ' + title);
  del.addEventListener('click', function() {
    var next = card.nextElementSibling || card.previousElementSibling;
    var nextId = next ? next.getAttribute('data-id') : null;
    archiveNote(note.id);
    if (nextId === null || !focusCard(nextId)) boardSearch.focus();
  });
  meta.appendChild(del);
  card.appendChild(meta);
  return card;
}

function buildBoardEmpty(filtered) {
  var empty = UI.el('div', 'board-empty');
  if (!filtered) empty.appendChild(UI.icon('note'));
  var message = UI.el('p');
  message.appendChild(UI.el('b', '', filtered ? 'No matches.' : 'No notes yet.'));
  message.appendChild(document.createTextNode(filtered ? 'Try a different search.' : 'Write your first one.'));
  empty.appendChild(message);
  var action = UI.el('button', filtered ? 'btn' : 'btn primary', filtered ? 'Clear search' : 'New note');
  action.type = 'button';
  action.addEventListener('click', function() {
    if (!filtered) { addNote(); return; }
    boardQuery = '';
    boardSearch.value = '';
    renderBoard();
    boardSearch.focus();
  });
  empty.appendChild(action);
  return empty;
}

function renderBoard() {
  // A rebuild must not take away the reader's scroll position or the keyboard's place.
  var active = document.activeElement;
  var focusedCard = active && active.closest ? active.closest('.scard') : null;
  var keepFocus = focusedCard && boardEl.contains(focusedCard) ? focusedCard.getAttribute('data-id') : null;
  var keepScroll = boardEl.scrollTop;

  UI.clear(boardEl);
  var list = filteredNotes();
  var filtered = list.length !== stickyNotes.length;
  noteCountEl.textContent = filtered
    ? list.length + ' of ' + stickyNotes.length
    : stickyNotes.length + (stickyNotes.length === 1 ? ' note' : ' notes');

  if (list.length === 0) {
    boardEl.appendChild(buildBoardEmpty(filtered));
    return;
  }
  list.forEach(function(note) { boardEl.appendChild(buildCard(note)); });
  boardEl.scrollTop = keepScroll;
  if (keepFocus !== null) focusCard(keepFocus);
}

/* ============ MARKDOWN RENDER (safe DOM) ============ */
function appendInline(el, text) {
  var re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  var last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
    var tok = m[0];
    if (tok.slice(0, 2) === '**') {
      var strong = document.createElement('strong'); strong.textContent = tok.slice(2, -2); el.appendChild(strong);
    } else if (tok.charAt(0) === '`') {
      // Inline code = click-to-copy (keys, links, short values)
      var code = document.createElement('code');
      code.className = 'copyable'; code.title = 'Click to copy';
      code.tabIndex = 0;
      code.setAttribute('role', 'button');
      code.setAttribute('aria-label', 'Copy ' + tok.slice(1, -1));
      code.setAttribute('data-copy', tok.slice(1, -1));
      code.textContent = tok.slice(1, -1);
      code.appendChild(UI.icon('copy'));
      el.appendChild(code);
    } else {
      var lm = tok.match(/\[([^\]]+)\]\(([^)]+)\)/);
      var a = document.createElement('a'); a.textContent = lm[1]; a.setAttribute('data-href', lm[2]); el.appendChild(a);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
}

/* ---- GitHub-flavored tables ---- */
// A cell counts as a metric only if it's a plain number — dates, years and
// reference ids (#226, 1/7/2026, 18.06.2026, 2026) are explicitly rejected.
function parseNum(s) {
  var raw = String(s || '').trim();
  if (/^\d{1,4}[/\-]\d{1,2}([/\-]\d{1,4})?$/.test(raw)) return NaN;   // 1/7, 2026-07-04
  if (/^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(raw)) return NaN;            // 18.06.2026
  if (/^(19|20)\d{2}$/.test(raw)) return NaN;                        // bare 4-digit year
  var t = raw.replace(/\s/g, '').replace(/,/g, '');
  if (/^-?\d+(\.\d+)?%?$/.test(t)) return parseFloat(t);             // 11, 38, 3.5, 80%
  return NaN;
}
// Header words that mean "this column is dates / ids", never a metric to chart.
function headerIsMeta(h) {
  return /дата|date|year|годин|месец|month|day|№|#|link|url|линк/i.test(String(h || ''));
}
function splitRow(line) {
  var s = line.trim();
  if (s.charAt(0) === '|') s = s.slice(1);
  if (s.charAt(s.length - 1) === '|') s = s.slice(0, -1);
  return s.split('|').map(function(c){ return c.trim(); });
}
function isTableSep(line) {
  var t = line.trim();
  return /^[\s|:\-]+$/.test(t) && t.indexOf('-') >= 0 && t.indexOf('|') >= 0;
}
function renderTable(header, rows, lineIdx) {
  var table = document.createElement('table');
  table.className = 'md-table';
  table.setAttribute('data-line', lineIdx);

  var htr = document.createElement('tr');
  header.forEach(function(h){ var th = document.createElement('th'); appendInline(th, h); htr.appendChild(th); });
  table.appendChild(htr);

  var ncols = header.length;
  var colNum = [], colMax = [];
  for (var c = 0; c < ncols; c++) {
    var nums = 0, mx = 0, tot = 0;
    rows.forEach(function(r){
      if (c < r.length && r[c] !== '') { tot++; var v = parseNum(r[c]); if (!isNaN(v)) { nums++; if (v > mx) mx = v; } }
    });
    // Only chart a column when it's genuinely numeric AND its header isn't a date/id.
    colNum[c] = !headerIsMeta(header[c]) && tot > 0 && nums > 0 && nums / tot >= 0.5;
    colMax[c] = mx || 1;
  }

  rows.forEach(function(r) {
    var tr = document.createElement('tr');
    for (var c = 0; c < ncols; c++) {
      var cellText = c < r.length ? r[c] : '';
      var td = document.createElement('td');
      if (colNum[c]) {
        var v = parseNum(cellText);
        var cell = document.createElement('div'); cell.className = 'mdt-cell' + (isNaN(v) ? ' txt' : '');
        var bar = document.createElement('div'); bar.className = 'mdt-bar';
        // One consistent colour per column; width alone shows magnitude.
        if (isNaN(v)) { bar.className += ' hatch'; bar.style.width = '100%'; }
        else { bar.style.width = (v / colMax[c] * 100) + '%'; }
        var val = document.createElement('span'); val.className = 'mdt-val'; appendInline(val, cellText);
        cell.appendChild(bar); cell.appendChild(val);
        td.appendChild(cell);
      } else {
        td.className = 'mdt-lbl'; appendInline(td, cellText);
      }
      tr.appendChild(td);
    }
    table.appendChild(tr);
  });
  renderOut.appendChild(table);
}

// Copyable card: a bordered box with the raw text + a big Copy button.
// Works for links, keys, whole messages — copies verbatim.
function renderCopyCard(text, lineIdx) {
  var card = document.createElement('div');
  card.className = 'copy-card'; card.setAttribute('data-line', lineIdx);
  var pre = document.createElement('div'); pre.className = 'copy-card-text';
  pre.textContent = text;
  var btn = document.createElement('button'); btn.className = 'copy-card-btn';
  btn.type = 'button'; btn.textContent = 'Copy';
  btn.addEventListener('click', function(e) {
    e.stopPropagation();
    doCopy(text);
    btn.textContent = 'Copied'; btn.classList.add('done');
    liveStatus.textContent = 'Copied';
    setTimeout(function(){ btn.textContent = 'Copy'; btn.classList.remove('done'); }, 1400);
  });
  card.appendChild(pre); card.appendChild(btn);
  renderOut.appendChild(card);
}

function renderCheckItem(ul, done, text, lineIdx) {
  var li = document.createElement('li');
  li.className = 'chk' + (done ? ' done' : '');
  li.setAttribute('data-line', lineIdx);
  var box = UI.el('button', 'check chk-box' + (done ? ' on' : ''));
  box.type = 'button';
  box.setAttribute('role', 'checkbox');
  box.setAttribute('aria-checked', done ? 'true' : 'false');
  box.setAttribute('aria-label', (done ? 'Mark not done: ' : 'Mark done: ') + text);
  box.appendChild(UI.icon('check'));
  li.appendChild(box);
  var label = UI.el('span', 'chk-text');
  appendInline(label, text);
  li.appendChild(label);
  ul.appendChild(li);
}

function renderMarkdown(src) {
  UI.clear(renderOut);
  if (!src.trim()) {
    var e = document.createElement('div'); e.className = 'empty-note';
    e.textContent = 'Empty note. Switch to Edit to start writing.';
    renderOut.appendChild(e);
    return;
  }
  var lines = src.split('\n');
  var ul = null;
  function endList(){ ul = null; }
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i], m, el;
    // Fenced copy block:  ```copy  ...multi-line...  ```
    if (/^```copy\s*$/i.test(l.trim())) {
      endList();
      var buf = [], k = i + 1;
      while (k < lines.length && !/^```\s*$/.test(lines[k].trim())) { buf.push(lines[k]); k++; }
      renderCopyCard(buf.join('\n'), i);
      i = k;   // skip past closing fence
      continue;
    }
    // Single-line copy flag:  copy: <anything>
    if ((m = l.match(/^copy:\s?(.*)/i))) {
      endList();
      renderCopyCard(m[1], i);
      continue;
    }
    // table block: a "| ... |" line followed by a "| --- | --- |" separator
    if (l.indexOf('|') >= 0 && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      endList();
      var header = splitRow(l);
      var trows = [];
      var j = i + 2;
      while (j < lines.length && lines[j].trim() !== '' && lines[j].indexOf('|') >= 0) {
        trows.push(splitRow(lines[j]));
        j++;
      }
      renderTable(header, trows, i);
      i = j - 1;
      continue;
    }
    if (/^---+\s*$/.test(l.trim()) && l.trim() !== '') {
      endList(); el = document.createElement('hr'); el.className = 'md-hr'; el.setAttribute('data-line', i); renderOut.appendChild(el);
    } else if ((m = l.match(/^#\s+(.*)/))) {
      endList(); el = document.createElement('h1'); el.setAttribute('data-line', i); appendInline(el, m[1]); renderOut.appendChild(el);
    } else if ((m = l.match(/^##\s+(.*)/))) {
      endList(); el = document.createElement('h2'); el.setAttribute('data-line', i); appendInline(el, m[1]); renderOut.appendChild(el);
    } else if ((m = l.match(/^-\s+\[( |x)\]\s+(.*)/))) {
      if (!ul) { ul = document.createElement('ul'); renderOut.appendChild(ul); }
      renderCheckItem(ul, m[1] === 'x', m[2], i);
    } else if ((m = l.match(/^[-*]\s+(.*)/))) {
      if (!ul) { ul = document.createElement('ul'); renderOut.appendChild(ul); }
      el = document.createElement('li'); el.setAttribute('data-line', i); appendInline(el, m[1]); ul.appendChild(el);
    } else if ((m = l.match(/^>\s?(.*)/))) {
      endList(); el = document.createElement('blockquote'); el.setAttribute('data-line', i); appendInline(el, m[1]); renderOut.appendChild(el);
    } else if (l.trim() === '') {
      endList();
    } else {
      endList(); el = document.createElement('p'); el.setAttribute('data-line', i); appendInline(el, l); renderOut.appendChild(el);
    }
  }
}

function buildOutline(src) {
  UI.clear(panelOutline);
  var lines = src.split('\n');
  var items = [];
  for (var i = 0; i < lines.length; i++) {
    var m1 = lines[i].match(/^#\s+(.*)/), m2 = lines[i].match(/^##\s+(.*)/);
    if (m1) items.push({ lvl: 1, t: m1[1], line: i });
    else if (m2) items.push({ lvl: 2, t: m2[1], line: i });
  }
  if (!items.length) {
    var e = document.createElement('div'); e.className = 'ol-empty';
    e.textContent = 'No headings yet. Add "# Title" or "## Section" to build your outline.';
    panelOutline.appendChild(e);
    return;
  }
  items.forEach(function(it) {
    var d = UI.el('button', 'ol-item' + (it.lvl === 2 ? ' h2' : ''), it.t);
    d.type = 'button';
    d.addEventListener('click', function(){ jumpToLine(it.line); closeHelperIfCovering(); });
    panelOutline.appendChild(d);
  });
}

/* ============ EDITOR ============ */
function openEditor(id) {
  activeNoteId = id;
  var note = getActiveNote();
  if (!note) return;
  boardScroll = boardEl.scrollTop;
  md.value = note.text || '';
  openedText = md.value;
  editorView.classList.remove('editing');
  editing = false;
  markPressed(readBtn, true);
  markPressed(editBtn, false);
  setHelperOpen(false);
  renderColorPick();
  refresh();
  boardView.classList.remove('active');
  editorView.classList.add('active');
  backBtn.focus();
}

function closeEditor() {
  flushSave();
  setHelperOpen(false);
  closeShareMenu();
  editorView.classList.remove('active');
  boardView.classList.add('active');
  renderBoard();
  boardEl.scrollTop = boardScroll;
  if (activeNoteId !== null) focusCard(activeNoteId);
}

function refresh() {
  var note = getActiveNote();
  if (!currentTaskId) editorTitle.textContent = note ? noteTitle(note) : 'Untitled';
  // Preserve the reader's scroll position across re-renders (kills the flicker-jump)
  var st = rendered.scrollTop;
  renderMarkdown(md.value);
  rendered.scrollTop = st;
  buildOutline(md.value);
  var words = md.value.replace(/[#>*`\-\[\]()]/g, ' ').trim().split(/\s+/).filter(Boolean).length;
  wcEl.textContent = words + (words === 1 ? ' word' : ' words');
  wcEl.appendChild(UI.el('span', 'wc-kind', ' · Markdown'));
}

/* Debounced preview render — typing no longer rebuilds the DOM per keystroke */
function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(function() {
    refreshTimer = null;
    refresh();
    if (editing) syncFromCaret();
  }, 120);
}

function onEdit() {
  var note = getActiveNote();
  if (note && !currentTaskId) { note.text = md.value; }
  if (md.value.length > NOTE_TEXT_MAX) {
    showToast('This note is over ' + NOTE_TEXT_MAX.toLocaleString() + ' characters. Anything past that will not be saved.', true);
  }
  scheduleRefresh();
  scheduleSave();
}

/* ---- scroll sync ---- */
function caretLine() {
  return md.value.slice(0, md.selectionStart).split('\n').length - 1;
}
function scrollPreviewToLine(line) {
  if (!editing) return;
  var blocks = renderOut.querySelectorAll('[data-line]');
  var target = null;
  for (var i = 0; i < blocks.length; i++) {
    if (parseInt(blocks[i].getAttribute('data-line'), 10) <= line) target = blocks[i]; else break;
  }
  if (!target) { rendered.scrollTop = 0; return; }
  var top = target.offsetTop - rendered.clientHeight / 2 + target.clientHeight / 2;
  rendered.scrollTo({ top: Math.max(0, top), behavior: scrollBehavior() });
}
function syncFromCaret() { scrollPreviewToLine(caretLine()); }

/* ---- save ---- */
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 500);
}
// `force`: something besides the text changed (the colour), so the note is saved either way.
function flushSave(force) {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (currentTaskId) {
    window.notesAPI.saveTaskNote(currentTaskId, md.value);
  } else {
    // No note opened yet: the list may not even have loaded, and writing it would empty the file.
    if (openedText === null) return;
    // Nothing typed since it was opened or saved: writing it back could undo a change that came in.
    if (md.value === openedText && !force) return;
    var note = getActiveNote();
    if (note) note.text = md.value;
    window.notesAPI.saveStickyNotes(stickyNotes);
    openedText = md.value;
  }
  savedChip.classList.add('show');
  setTimeout(function(){ savedChip.classList.remove('show'); }, 1000);
}

/* ---- color picker ---- */
function renderColorPick() {
  UI.clear(colorPick);
  if (currentTaskId) return;   // task notes have no color
  var cur = colorKeyOf(getActiveNote());
  COLORS.forEach(function(c) {
    var swatch = UI.el('button', 'swatch c-' + c.key);
    swatch.type = 'button';
    swatch.title = c.label;
    swatch.setAttribute('aria-label', c.label);
    swatch.setAttribute('aria-pressed', c.key === cur ? 'true' : 'false');
    swatch.addEventListener('click', function() {
      // Looked up now: a change from another device replaces the list behind this button.
      var note = getActiveNote();
      if (!note) return;
      note.color = c.key;
      renderColorPick();
      colorPick.querySelector('.c-' + c.key).focus();
      flushSave(true);
    });
    colorPick.appendChild(swatch);
  });
}

/* ---- insert markdown snippet at caret (from syntax helper) ---- */
function insertSnippet(str) {
  setEditMode(true);
  var s = md.selectionStart != null ? md.selectionStart : md.value.length;
  md.value = md.value.slice(0, s) + str + md.value.slice(s);
  md.focus();
  md.selectionStart = md.selectionEnd = s + str.length;
  onEdit();
}

/* ---- jump preview/edit to a source line (outline click) ---- */
function jumpToLine(line) {
  if (editing) {
    var pos = md.value.split('\n').slice(0, line).join('\n').length + (line > 0 ? 1 : 0);
    md.focus();
    md.selectionStart = md.selectionEnd = pos;
    scrollPreviewToLine(line);
  } else {
    scrollPreviewToLine(line);
    // in read mode force-scroll the rendered block into view
    var block = renderOut.querySelector('[data-line="' + line + '"]');
    if (block) rendered.scrollTo({ top: Math.max(0, block.offsetTop - 14), behavior: scrollBehavior() });
  }
}

/* ---- read / edit mode ---- */
function setEditMode(on) {
  editing = on;
  if (!on && typeof closeSlash === 'function') closeSlash();
  if (blockEditing) commitBlockEdit(true);
  editorView.classList.toggle('editing', on);
  markPressed(editBtn, on);
  markPressed(readBtn, !on);
  if (on) { setTimeout(function(){ md.focus(); }, 0); }
}

/* ---- outline and syntax drawer ---- */
function setHelperOpen(open) {
  helper.classList.toggle('open', open);
  helpBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
}
// In a narrow window the drawer hides the very place the reader just asked to go to.
function closeHelperIfCovering() {
  if (helper.offsetWidth >= edContent.clientWidth * 0.75) setHelperOpen(false);
}

/* ============ ARCHIVE ============ */
function archiveNote(id) {
  var note = stickyNotes.find(function(n){ return n.id === id; });
  if (!note) return;
  window.notesAPI.archiveNote({ id: note.id, title: noteTitle(note), text: note.text, color: note.color, createdAt: note.createdAt });
  stickyNotes = stickyNotes.filter(function(n){ return n.id !== id; });
  if (activeNoteId === id) activeNoteId = stickyNotes.length ? stickyNotes[0].id : null;
  window.notesAPI.saveStickyNotes(stickyNotes);
  renderBoard();
}
function closeArchive() {
  archivePanel.classList.remove('visible');
  boardView.classList.remove('archive-open');
  archiveBtn.focus();
}
function openArchive() {
  archivePanel.classList.add('visible');
  boardView.classList.add('archive-open');
  UI.clear(archivePanel);
  var header = UI.el('div', 'archive-header');
  header.appendChild(UI.el('h2', '', 'Deleted notes'));
  var back = UI.el('button', 'btn small');
  back.type = 'button';
  back.appendChild(UI.icon('prev'));
  back.appendChild(document.createTextNode('Back'));
  back.addEventListener('click', closeArchive);
  header.appendChild(back);
  archivePanel.appendChild(header);
  back.focus();

  window.notesAPI.getArchive().then(function(archive) {
    if (!archive || !archive.length) {
      archivePanel.appendChild(UI.el('div', 'empty', 'No deleted notes.'));
      return;
    }
    var listEl = UI.el('div', 'archive-list card');
    archive.forEach(function(note) {
      var noteName = note.title || (note.text || '').split('\n')[0].slice(0, 30) || 'Untitled';
      var item = UI.el('div', 'archive-item');
      item.appendChild(UI.el('span', 'archive-stripe c-' + colorKeyOf(note)));
      var txt = UI.el('div');
      txt.appendChild(UI.el('div', 'archive-title', noteName));
      if (note.archivedAt) txt.appendChild(UI.el('div', 'archive-date', new Date(note.archivedAt).toLocaleDateString()));
      item.appendChild(txt);
      var btn = UI.el('button', 'btn small', 'Restore');
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Restore ' + noteName);
      btn.addEventListener('click', function() {
        if (stickyNotes.length >= NOTES_MAX) {
          showToast('The board is full at ' + NOTES_MAX + ' notes. Delete one to bring this back.', true);
          return;
        }
        stickyNotes.push({ id: note.id, title: note.title, text: note.text, color: note.color, createdAt: note.createdAt });
        window.notesAPI.restoreFromArchive(note.id);
        window.notesAPI.saveStickyNotes(stickyNotes);
        renderBoard();
        closeArchive();
      });
      item.appendChild(btn);
      listEl.appendChild(item);
    });
    archivePanel.appendChild(listEl);
  }, function(err) {
    console.error('[notes] could not read the deleted notes', err);
    archivePanel.appendChild(UI.el('div', 'empty', 'The deleted notes could not be loaded.'));
  });
}

/* ============ CRUD ============ */
// The same limits main.js and the phone's sync keep to. Saying so beats dropping words later.
var NOTES_MAX = 50;
var NOTE_TEXT_MAX = 100000;

function addNote() {
  if (stickyNotes.length >= NOTES_MAX) {
    showToast('The board is full at ' + NOTES_MAX + ' notes. Delete one to add another.', true);
    return;
  }
  var note = { id: genId(), title: '', text: '', color: 'default', createdAt: Date.now() };
  stickyNotes.push(note);
  window.notesAPI.saveStickyNotes(stickyNotes);
  openEditor(note.id);
  setEditMode(true);
}

/* ============ READ-VIEW BLOCK EDITING ============ */
/* Click a rendered block → edit just that source line in place. Enter/blur commits, Esc cancels. */
function startBlockEdit(el) {
  if (editing) return;
  if (blockEditing) commitBlockEdit(true);
  // Committing the previous block re-renders the preview — if our element got
  // replaced by that rebuild, re-find its fresh counterpart by source line.
  if (!el.isConnected) {
    el = renderOut.querySelector('[data-line="' + el.getAttribute('data-line') + '"]');
    if (!el) return;
  }
  var line = parseInt(el.getAttribute('data-line'), 10);
  var lines = md.value.split('\n');
  if (isNaN(line) || lines[line] == null) return;

  var ta = document.createElement('textarea');
  ta.className = 'field blk-edit';
  ta.setAttribute('aria-label', 'Edit this block');
  ta.value = lines[line];
  ta.spellcheck = true;
  el.style.display = 'none';
  el.parentNode.insertBefore(ta, el.nextSibling);
  blockEditing = { el: el, ta: ta, line: line };

  function autosize() { ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 2) + 'px'; }
  autosize();
  ta.addEventListener('input', autosize);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = ta.value.length;

  ta.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitBlockEdit(true); }
    else if (e.key === 'Escape') { e.preventDefault(); commitBlockEdit(false); }
  });
  ta.addEventListener('blur', function() { commitBlockEdit(true); });
}

function commitBlockEdit(save) {
  if (!blockEditing) return;
  var be = blockEditing; blockEditing = null;
  var val = be.ta.value;
  try { be.ta.parentNode.removeChild(be.ta); } catch (e) { /* already gone */ }
  be.el.style.display = '';
  if (!save) return;
  var lines = md.value.split('\n');
  if (lines[be.line] == null || lines[be.line] === val) return;
  // Shift+Enter allows multi-line replacements of a single source line
  var repl = val.split('\n');
  Array.prototype.splice.apply(lines, [be.line, 1].concat(repl));
  md.value = lines.join('\n');
  var note = getActiveNote();
  if (note && !currentTaskId) note.text = md.value;
  flushSave();
  refresh();
}

/* ============ WIRING ============ */
md.addEventListener('input', function(){ onEdit(); syncFromCaret(); updateSlash(); });
md.addEventListener('keyup', syncFromCaret);
md.addEventListener('click', syncFromCaret);
md.addEventListener('scroll', function() {
  if (!editing) return;
  var ratio = md.scrollTop / Math.max(1, md.scrollHeight - md.clientHeight);
  rendered.scrollTop = ratio * (rendered.scrollHeight - rendered.clientHeight);
});

/* Read-view clicks: copy chips, checkbox toggles, and tap-to-edit blocks */
function toggleCheckbox(li) {
  var line = parseInt(li.getAttribute('data-line'), 10);
  var lines = md.value.split('\n');
  if (lines[line] != null) {
    lines[line] = lines[line].replace(/\[( |x)\]/, function(_, c){ return c === 'x' ? '[ ]' : '[x]'; });
    md.value = lines.join('\n');
    var note = getActiveNote();
    if (note && !currentTaskId) note.text = md.value;
    flushSave();
    refresh();
    // The render above replaced the box the keyboard was on.
    var again = renderOut.querySelector('li[data-line="' + line + '"] .chk-box');
    if (again) again.focus();
  }
}

function copyChip(chip) {
  doCopy(chip.getAttribute('data-copy') || chip.textContent);
  liveStatus.textContent = 'Copied';
  chip.classList.remove('copied'); void chip.offsetWidth; chip.classList.add('copied');
  setTimeout(function(){ chip.classList.remove('copied'); }, 1100);
}

renderOut.addEventListener('keydown', function(e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  if (!e.target.classList || !e.target.classList.contains('copyable')) return;
  e.preventDefault();
  copyChip(e.target);
});

renderOut.addEventListener('click', function(e) {
  if (blockEditing && blockEditing.ta.contains(e.target)) return;
  // Click-to-copy on inline `code` chips
  var chip = e.target.closest && e.target.closest('code.copyable');
  if (chip) {
    copyChip(chip);
    return;
  }
  var li = e.target.closest && e.target.closest('li.chk');
  if (li) {
    // Clicking the checkbox square toggles; clicking the text edits in place (Read mode)
    var inBox = Boolean(e.target.closest('.chk-box'));
    if (editing || inBox) toggleCheckbox(li);
    else startBlockEdit(li);
    return;
  }
  if (!editing) {
    // Empty note → focus quick capture
    if (e.target.classList && e.target.classList.contains('empty-note')) {
      if (captureInput) captureInput.focus();
      return;
    }
    var blk = e.target.closest && e.target.closest('[data-line]');
    if (blk && renderOut.contains(blk) &&
        blk.tagName !== 'TABLE' &&
        !blk.classList.contains('copy-card')) {
      startBlockEdit(blk);
    }
  }
});

// Copy text to OS clipboard (prefer IPC → Electron clipboard; fall back to Web API)
function doCopy(text) {
  try {
    if (window.notesAPI && window.notesAPI.copyText) { window.notesAPI.copyText(String(text)); return; }
  } catch (e) { /* fall through */ }
  try { navigator.clipboard.writeText(String(text)); } catch (e) { /* ignore */ }
}

/* ============ QUICK-CAPTURE BAR ============ */
/* Continues the format of the last line: checklist stays checklist, bullets stay bullets */
function smartPrefix(text) {
  if (/^([#>]|[-*]\s|\d+\.\s|copy:)/.test(text)) return text;   // already markdown
  var lines = md.value.split('\n');
  for (var i = lines.length - 1; i >= 0; i--) {
    var l = lines[i].trim();
    if (!l) continue;
    if (/^-\s\[( |x)\]/.test(l)) return '- [ ] ' + text;
    if (/^[-*]\s/.test(l)) return '- ' + text;
    break;
  }
  return text;
}
function captureAdd() {
  var v = captureInput.value.trim();
  if (!v) return;
  var line = smartPrefix(v);
  var base = md.value.replace(/\s+$/, '');
  md.value = base ? base + '\n' + line : line;
  captureInput.value = '';
  var note = getActiveNote();
  if (note && !currentTaskId) note.text = md.value;
  flushSave();
  refresh();
  rendered.scrollTop = rendered.scrollHeight;
  captureInput.focus();
}
if (captureInput) {
  captureInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); captureAdd(); }
  });
  captureBtn.addEventListener('click', captureAdd);
}

/* ============ SLASH COMMANDS ============ */
var SLASH_ITEMS = [
  { k: '#',    d: 'Big heading',   ins: '# ' },
  { k: '##',   d: 'Section',       ins: '## ' },
  { k: '[]',   d: 'Checkbox',      ins: '- [ ] ' },
  { k: '-',    d: 'Bullet',        ins: '- ' },
  { k: '>',    d: 'Callout',       ins: '> ' },
  { k: '| |',  d: 'Table with bars', ins: '| Metric | Value |\n| --- | --- |\n| row 1 | 11 |\n| row 2 | 38 |\n' },
  { k: 'copy', d: 'Copy button',   ins: 'copy: ' },
  { k: '---',  d: 'Divider',       ins: '---\n' },
  { k: 'date', d: "Today's date",  ins: null },   // dynamic
];
var slashState = null;   // { start, items, sel }

function slashQueryAt() {
  var pos = md.selectionStart;
  var before = md.value.slice(0, pos);
  var m = before.match(/(^|\n)\/([a-zA-Z#\->\[\]|]{0,12})$/);
  if (!m) return null;
  return { start: pos - m[2].length - 1, q: m[2].toLowerCase() };
}
function closeSlash() { slashState = null; slashMenu.classList.remove('open'); }
function renderSlash() {
  UI.clear(slashMenu);
  slashState.items.forEach(function(it, idx) {
    var row = UI.el('div', 'slash-item' + (idx === slashState.sel ? ' sel' : ''));
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', idx === slashState.sel ? 'true' : 'false');
    row.appendChild(UI.el('code', '', it.k));
    row.appendChild(document.createTextNode(it.d));
    row.addEventListener('mousedown', function(e) { e.preventDefault(); applySlash(it); });
    slashMenu.appendChild(row);
  });
  var selected = slashMenu.querySelector('.sel');
  if (selected) selected.scrollIntoView({ block: 'nearest' });
}
// How far down the textarea's text the caret is, wrapped lines included: a copy of the text up to
// the caret, set in the same width and type, ends where the caret is.
function caretTopInText() {
  var style = getComputedStyle(md);
  var mirror = document.createElement('div');
  mirror.setAttribute('aria-hidden', 'true');
  mirror.style.cssText = 'position:absolute;visibility:hidden;left:0;top:0;white-space:pre-wrap;overflow-wrap:break-word;';
  mirror.style.width = md.clientWidth + 'px';
  mirror.style.padding = style.padding;
  mirror.style.fontFamily = style.fontFamily;
  mirror.style.fontSize = style.fontSize;
  mirror.style.fontWeight = style.fontWeight;
  mirror.style.lineHeight = style.lineHeight;
  mirror.textContent = md.value.slice(0, md.selectionStart);
  var mark = document.createElement('span');
  mark.textContent = '​';
  mirror.appendChild(mark);
  rawPane.appendChild(mirror);
  var top = mark.offsetTop;
  rawPane.removeChild(mirror);
  return top;
}
// Under the caret when it fits above the bottom of the note, else over it.
function positionSlash() {
  var lh = parseFloat(getComputedStyle(md).lineHeight) || 20;
  var caretTop = md.offsetTop + caretTopInText() - md.scrollTop;
  var limit = edContent.clientHeight - rawPane.offsetTop - 6;
  // Every command when the note has the room, and scrolling when it hasn't.
  slashMenu.style.maxHeight = Math.max(90, limit - 8) + 'px';
  var menuHeight = slashMenu.offsetHeight;
  var top = caretTop + lh + 4;
  if (top + menuHeight > limit) top = caretTop - menuHeight - 4;
  slashMenu.style.top = Math.max(4, Math.min(top, limit - menuHeight)) + 'px';
}
function updateSlash() {
  if (!editing) { closeSlash(); return; }
  var s = slashQueryAt();
  if (!s) { closeSlash(); return; }
  var items = SLASH_ITEMS.filter(function(it) {
    return !s.q || it.d.toLowerCase().indexOf(s.q) !== -1 || it.k.indexOf(s.q) !== -1;
  });
  if (!items.length) { closeSlash(); return; }
  var keepSel = slashState ? Math.min(slashState.sel, items.length - 1) : 0;
  slashState = { start: s.start, items: items, sel: keepSel };
  renderSlash();
  slashMenu.classList.add('open');
  positionSlash();
}
function applySlash(item) {
  if (!slashState) return;
  var ins = item.ins != null ? item.ins : (new Date().toLocaleDateString() + ' ');
  var end = md.selectionStart;
  md.value = md.value.slice(0, slashState.start) + ins + md.value.slice(end);
  var np = slashState.start + ins.length;
  closeSlash();
  md.focus();
  md.selectionStart = md.selectionEnd = np;
  onEdit();
}
md.addEventListener('keydown', function(e) {
  if (!slashState) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); slashState.sel = (slashState.sel + 1) % slashState.items.length; renderSlash(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); slashState.sel = (slashState.sel - 1 + slashState.items.length) % slashState.items.length; renderSlash(); }
  else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); applySlash(slashState.items[slashState.sel]); }
  else if (e.key === 'Escape') { e.preventDefault(); closeSlash(); }
});
md.addEventListener('blur', function() { setTimeout(closeSlash, 150); });

/* ============ BOARD SEARCH ============ */
if (boardSearch) {
  boardSearch.addEventListener('input', function() {
    boardQuery = this.value;
    renderBoard();
  });
}

readBtn.addEventListener('click', function(){ setEditMode(false); });
editBtn.addEventListener('click', function(){ setEditMode(true); });
backBtn.addEventListener('click', function() {
  if (!currentTaskId) { closeEditor(); return; }
  // The embedded page has no window to close, so a task note goes back to the board there.
  if (isEmbedMode) leaveTaskNote(); else window.notesAPI.close();
});
helpBtn.addEventListener('click', function(e) {
  var open = !helper.classList.contains('open');
  setHelperOpen(open);
  // From the keyboard (a click with no pointer behind it) go in, or the whole note lies in between.
  if (open && e.detail === 0) document.querySelector('#helper .switch .on').focus();
});
document.getElementById('helperClose').addEventListener('click', function() {
  setHelperOpen(false);
  helpBtn.focus();
});
document.getElementById('tabOutline').addEventListener('click', function() {
  markPressed(this, true); markPressed(document.getElementById('tabSyntax'), false);
  panelOutline.classList.remove('hidden'); document.getElementById('panelSyntax').classList.add('hidden');
});
document.getElementById('tabSyntax').addEventListener('click', function() {
  markPressed(this, true); markPressed(document.getElementById('tabOutline'), false);
  document.getElementById('panelSyntax').classList.remove('hidden'); panelOutline.classList.add('hidden');
});
Array.prototype.forEach.call(document.querySelectorAll('.cheat-row'), function(row) {
  row.addEventListener('click', function(){ insertSnippet(row.getAttribute('data-ins')); closeHelperIfCovering(); });
});

document.getElementById('addNoteBtn').addEventListener('click', function(){ if (!currentTaskId) addNote(); });
archiveBtn.addEventListener('click', openArchive);

/* ---- share / export ---- */
var shareMenu = document.getElementById('shareMenu');
var shareBtn = document.getElementById('shareBtn');
var exportToast = document.getElementById('exportToast');
var toastTimer = null;
function showToast(msg, isErr) {
  clearTimeout(toastTimer);
  exportToast.textContent = msg;
  exportToast.className = 'export-toast show' + (isErr ? ' err' : '');
  toastTimer = setTimeout(hideToast, 2600);
}
function hideToast() {
  clearTimeout(toastTimer);
  exportToast.classList.remove('show');
}
function exportContext() {
  flushSave();
  if (currentTaskId) return { title: (editorTitle.textContent || 'Task note'), text: md.value };
  var note = getActiveNote();
  return { title: note ? noteTitle(note) : 'Note', text: md.value };
}
function closeShareMenu() {
  shareMenu.classList.remove('open');
  shareBtn.setAttribute('aria-expanded', 'false');
}
shareBtn.addEventListener('click', function(e){
  e.stopPropagation();
  var open = !shareMenu.classList.contains('open');
  shareMenu.classList.toggle('open', open);
  shareBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
});
document.addEventListener('click', function(e){
  if (shareMenu.classList.contains('open') && !e.target.closest('.share-wrap')) closeShareMenu();
});
function runExport(exporter, busyText, failText) {
  closeShareMenu();
  shareBtn.focus();
  showToast(busyText);
  exporter(exportContext()).then(function(r){
    if (r && r.ok) showToast('Saved ' + baseName(r.path));
    else if (r && r.canceled) hideToast();
    else showToast(failText, true);
  }, function(err) {
    console.error('[notes] export failed', err);
    showToast(failText, true);
  });
}
document.getElementById('exportMdBtn').addEventListener('click', function(){
  runExport(window.notesAPI.exportMd, 'Exporting Markdown…', 'Export failed');
});
document.getElementById('exportPdfBtn').addEventListener('click', function(){
  runExport(window.notesAPI.exportPdf, 'Rendering PDF…', 'PDF export failed');
});
function baseName(p){ return p ? String(p).replace(/\\/g, '/').split('/').pop() : ''; }

/* Escape backs out of whatever is open on top, one layer at a time. Editors that use it themselves
   (the slash menu, a block being edited) mark the event as handled. */
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  if (shareMenu.classList.contains('open')) { closeShareMenu(); shareBtn.focus(); return; }
  if (helper.classList.contains('open')) { setHelperOpen(false); helpBtn.focus(); return; }
  if (archivePanel.classList.contains('visible')) closeArchive();
});

/* window controls (both bars) — app mode gets real minimize; panel mode hides */
function closeWin(){ flushSave(); window.notesAPI.close(); }
function minWin(){
  if (isAppMode && window.notesAPI.minimize) { flushSave(); window.notesAPI.minimize(); }
  else closeWin();
}
document.getElementById('minBtnBoard').addEventListener('click', minWin);
document.getElementById('closeBtnBoard').addEventListener('click', closeWin);
document.getElementById('minBtnEd').addEventListener('click', minWin);
document.getElementById('closeBtnEd').addEventListener('click', closeWin);

/* The dashboard closes its page with unload events, and hides it without any warning. Either way,
   words still waiting on the save timer go now. Only those: there may be nothing to save yet. */
function saveWaitingWork() {
  if (blockEditing) commitBlockEdit(true);
  if (saveTimer) flushSave();
}
window.addEventListener('beforeunload', saveWaitingWork);
document.addEventListener('visibilitychange', function() {
  if (document.hidden) saveWaitingWork();
});

/* Cross-window sync: panel and app window edit the same notes file */
if (window.notesAPI.onNotesUpdated) {
  window.notesAPI.onNotesUpdated(function(notes) {
    if (!Array.isArray(notes)) return;
    stickyNotes = notes;
    if (activeNoteId && editorView.classList.contains('active') && !currentTaskId) {
      var mine = getActiveNote();
      if (mine) takeIncoming(mine);
    }
    if (boardView.classList.contains('active')) renderBoard();
  });
}

/*
 * A change to the open note from elsewhere (the other notes window, the phone, the watch).
 * Nothing typed here: the editor shows it. Typed here too: lines only added there join the text
 * typed here; any other change is kept as a note of its own - neither side is written over.
 */
function takeIncoming(mine) {
  var incoming = mine.text || '';
  if (md.value === openedText) {
    if (incoming !== md.value) { md.value = incoming; openedText = incoming; refresh(); }
    return;
  }
  if (incoming !== openedText) {
    var added = linesAddedTo(openedText || '', incoming);
    if (added) {
      var from = md.selectionStart, to = md.selectionEnd;
      md.value = md.value.replace(/\s+$/, '') + '\n' + added.join('\n');
      md.setSelectionRange(from, to);
    } else if (stickyNotes.length < 50) {
      stickyNotes.push({ id: genId(), title: '', text: withCopyHeading(incoming), color: mine.color || 'default', createdAt: Date.now() });
    } else {
      showToast('Changed on another device too - the board is full, so this text replaces it', true);
    }
    openedText = incoming;
    scheduleSave();
  }
  mine.text = md.value;
}

// The lines `text` adds after `base`, or null when it changed anything else.
function linesAddedTo(base, text) {
  var b = base.replace(/\s+$/, '').split('\n');
  var t = text.replace(/\s+$/, '').split('\n');
  if (t.length <= b.length) return null;
  for (var i = 0; i < b.length; i++) if (b[i] !== t[i]) return null;
  return t.slice(b.length);
}

function withCopyHeading(text) {
  var lines = text.split('\n');
  for (var i = 0; i < lines.length; i++) {
    if (/^#[ \t]+\S/.test(lines[i])) { lines[i] = lines[i].replace(/[ \t\r]+$/, '') + ' (conflict copy)'; return lines.join('\n'); }
  }
  return '# Conflict copy\n' + text;
}

/* ============ DATA LOAD ============ */
window.notesAPI.getStickyNotes().then(function(notes) {
  if (notes && notes.length) {
    stickyNotes = notes;
  } else {
    window.notesAPI.getNotes().then(function(oldText) {
      if (oldText && oldText.trim()) {
        stickyNotes = [{ id: genId(), title: '', text: oldText, color: 'default', createdAt: Date.now() }];
      } else {
        stickyNotes = [];
      }
      window.notesAPI.saveStickyNotes(stickyNotes);
      renderBoard();
    });
    return;
  }
  renderBoard();
});

/* ============ TASK-NOTE MODE ============ */
window.notesAPI.onLoadTaskNote(function(data) {
  flushSave();
  currentTaskId = data.taskId;
  editorTitle.textContent = data.taskText ? data.taskText.slice(0, 40) : 'Task note';
  if (!isEmbedMode) backBtn.style.display = 'none';
  renderColorPick();
  window.notesAPI.getTaskNote(data.taskId).then(function(text) {
    md.value = text || '';
    setEditMode(false);
    refresh();
    boardView.classList.remove('active');
    editorView.classList.add('active');
  });
});

function leaveTaskNote() {
  if (currentTaskId) window.notesAPI.saveTaskNote(currentTaskId, md.value);
  currentTaskId = null;
  // The editor still holds the task's text: nothing may save it as the note opened before it.
  openedText = null;
  backBtn.style.display = '';
  editorView.classList.remove('active');
  boardView.classList.add('active');
  renderBoard();
}
window.notesAPI.onLoadGlobalNote(leaveTaskNote);

/* ============ THEME + SNAP ============ */
window.notesAPI.onThemeUpdate(UI.applyTheme);

window.notesAPI.onSnapGlow(function() {
  var glow = document.getElementById('glowLayer');
  glow.classList.remove('snap-glow');
  void glow.offsetWidth;
  glow.classList.add('snap-glow');
});
