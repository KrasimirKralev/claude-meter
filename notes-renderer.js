/* Notes renderer — sticky board + markdown read/edit editor.
   Safe DOM only (no innerHTML). */

var stickyNotes = [];
var activeNoteId = null;
var currentTaskId = null;
var saveTimer = null;
var editing = false;

/* note color key -> sticky card class + swatch color */
var COLORS = [
  { key: 'default', css: '#ffffff' },
  { key: 'yellow',  css: '#ffc900' },
  { key: 'pink',    css: '#ff90e8' },
  { key: 'green',   css: '#9ee7c8' },
  { key: 'blue',    css: '#a9d5ff' },
  { key: 'purple',  css: '#c5b3f6' },
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

/* ---- helpers ---- */
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function getActiveNote() { return stickyNotes.find(function(n) { return n.id === activeNoteId; }); }
function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

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

/* ============ BOARD ============ */
function renderBoard() {
  clear(boardEl);
  noteCountEl.textContent = stickyNotes.length + (stickyNotes.length === 1 ? ' note' : ' notes');

  if (stickyNotes.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'board-empty';
    var b = document.createElement('b'); b.textContent = 'No notes yet.';
    empty.appendChild(b);
    empty.appendChild(document.createTextNode(' Click + to pin your first one.'));
    boardEl.appendChild(empty);
    return;
  }

  stickyNotes.forEach(function(note) {
    var card = document.createElement('div');
    card.className = 'scard c-' + (note.color || 'default');

    var pin = document.createElement('div'); pin.className = 'pin'; card.appendChild(pin);

    var t = document.createElement('div'); t.className = 'sc-title';
    t.textContent = noteTitle(note); card.appendChild(t);

    var body = document.createElement('div'); body.className = 'sc-body';
    body.textContent = notePreview(note) || 'Empty note'; card.appendChild(body);

    var meta = document.createElement('div'); meta.className = 'sc-meta';
    var when = document.createElement('span');
    when.textContent = note.createdAt ? new Date(note.createdAt).toLocaleDateString() : '';
    meta.appendChild(when);
    var del = document.createElement('button'); del.className = 'sc-del'; del.textContent = '×'; del.title = 'Delete';
    del.addEventListener('click', function(e){ e.stopPropagation(); archiveNote(note.id); });
    meta.appendChild(del);
    card.appendChild(meta);

    card.addEventListener('click', function(){ openEditor(note.id); });
    boardEl.appendChild(card);
  });
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
      code.setAttribute('data-copy', tok.slice(1, -1));
      code.textContent = tok.slice(1, -1);
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
    btn.textContent = 'Copied!'; btn.classList.add('done');
    setTimeout(function(){ btn.textContent = 'Copy'; btn.classList.remove('done'); }, 1400);
  });
  card.appendChild(pre); card.appendChild(btn);
  renderOut.appendChild(card);
}

function renderMarkdown(src) {
  clear(renderOut);
  if (!src.trim()) {
    var e = document.createElement('div'); e.className = 'empty-note';
    e.textContent = 'Empty note — switch to Edit to start writing.';
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
    if ((m = l.match(/^#\s+(.*)/))) {
      endList(); el = document.createElement('h1'); el.setAttribute('data-line', i); appendInline(el, m[1]); renderOut.appendChild(el);
    } else if ((m = l.match(/^##\s+(.*)/))) {
      endList(); el = document.createElement('h2'); el.setAttribute('data-line', i); appendInline(el, m[1]); renderOut.appendChild(el);
    } else if ((m = l.match(/^-\s+\[( |x)\]\s+(.*)/))) {
      if (!ul) { ul = document.createElement('ul'); renderOut.appendChild(ul); }
      el = document.createElement('li'); el.className = 'chk' + (m[1] === 'x' ? ' done' : ''); el.setAttribute('data-line', i); appendInline(el, m[2]); ul.appendChild(el);
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
  clear(panelOutline);
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
    var d = document.createElement('div');
    d.className = 'ol-item' + (it.lvl === 2 ? ' h2' : '');
    d.textContent = it.t;
    d.addEventListener('click', function(){ jumpToLine(it.line); });
    panelOutline.appendChild(d);
  });
}

/* ============ EDITOR ============ */
function openEditor(id) {
  activeNoteId = id;
  var note = getActiveNote();
  if (!note) return;
  md.value = note.text || '';
  editorView.classList.remove('editing');
  editing = false;
  document.getElementById('readBtn').classList.add('on');
  document.getElementById('editBtn').classList.remove('on');
  helper.classList.remove('open');
  renderColorPick();
  refresh();
  boardView.classList.remove('active');
  editorView.classList.add('active');
}

function closeEditor() {
  flushSave();
  helper.classList.remove('open');
  editorView.classList.remove('active');
  boardView.classList.add('active');
  renderBoard();
}

function refresh() {
  var note = getActiveNote();
  editorTitle.textContent = note ? noteTitle(note) : 'Untitled';
  renderMarkdown(md.value);
  buildOutline(md.value);
  var words = md.value.replace(/[#>*`\-\[\]()]/g, ' ').trim().split(/\s+/).filter(Boolean).length;
  wcEl.textContent = words + ' words · markdown';
}

function onEdit() {
  var note = getActiveNote();
  if (note && !currentTaskId) { note.text = md.value; }
  refresh();
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
  rendered.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}
function syncFromCaret() { scrollPreviewToLine(caretLine()); }

/* ---- save ---- */
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 500);
}
function flushSave() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (currentTaskId) {
    window.notesAPI.saveTaskNote(currentTaskId, md.value);
  } else {
    var note = getActiveNote();
    if (note) note.text = md.value;
    window.notesAPI.saveStickyNotes(stickyNotes);
  }
  savedChip.classList.add('show');
  setTimeout(function(){ savedChip.classList.remove('show'); }, 1000);
}

/* ---- color picker ---- */
function renderColorPick() {
  clear(colorPick);
  if (currentTaskId) return;   // task notes have no color
  var note = getActiveNote();
  var cur = note ? (note.color || 'default') : 'default';
  COLORS.forEach(function(c) {
    var i = document.createElement('i');
    i.style.background = c.css;
    if (c.key === cur) i.className = 'sel';
    i.title = c.key;
    i.addEventListener('click', function() {
      if (!note) return;
      note.color = c.key;
      renderColorPick();
      flushSave();
    });
    colorPick.appendChild(i);
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
    if (block) rendered.scrollTo({ top: Math.max(0, block.offsetTop - 14), behavior: 'smooth' });
  }
}

/* ---- read / edit mode ---- */
function setEditMode(on) {
  editing = on;
  editorView.classList.toggle('editing', on);
  document.getElementById('editBtn').classList.toggle('on', on);
  document.getElementById('readBtn').classList.toggle('on', !on);
  if (on) { setTimeout(function(){ md.focus(); }, 0); }
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
function openArchive() {
  archivePanel.classList.add('visible');
  clear(archivePanel);
  var header = document.createElement('div'); header.className = 'archive-header';
  var title = document.createElement('span'); title.className = 'archive-title'; title.textContent = 'Deleted Notes';
  var back = document.createElement('button'); back.className = 'archive-back'; back.textContent = '← Back';
  back.addEventListener('click', function(){ archivePanel.classList.remove('visible'); });
  header.appendChild(title); header.appendChild(back); archivePanel.appendChild(header);

  window.notesAPI.getArchive().then(function(archive) {
    if (!archive || !archive.length) {
      var e = document.createElement('div'); e.className = 'archive-empty'; e.textContent = 'No deleted notes';
      archivePanel.appendChild(e); return;
    }
    archive.forEach(function(note) {
      var item = document.createElement('div'); item.className = 'archive-item';
      var colorObj = COLORS.find(function(c){ return c.key === note.color; }) || COLORS[0];
      item.style.borderLeftColor = colorObj.css === '#ffffff' ? '#111' : colorObj.css;
      var txt = document.createElement('div'); txt.className = 'archive-item-text';
      txt.textContent = note.title || (note.text || '').split('\n')[0].slice(0, 30) || 'Untitled';
      item.appendChild(txt);
      var date = document.createElement('div'); date.className = 'archive-item-date';
      if (note.archivedAt) date.textContent = new Date(note.archivedAt).toLocaleDateString();
      item.appendChild(date);
      var btn = document.createElement('button'); btn.className = 'archive-item-btn'; btn.textContent = 'Restore';
      btn.addEventListener('click', function() {
        stickyNotes.push({ id: note.id, title: note.title, text: note.text, color: note.color, createdAt: note.createdAt });
        window.notesAPI.restoreFromArchive(note.id);
        window.notesAPI.saveStickyNotes(stickyNotes);
        archivePanel.classList.remove('visible');
        renderBoard();
      });
      item.appendChild(btn);
      archivePanel.appendChild(item);
    });
  });
}

/* ============ CRUD ============ */
function addNote() {
  var note = { id: genId(), title: '', text: '', color: 'default', createdAt: Date.now() };
  stickyNotes.push(note);
  window.notesAPI.saveStickyNotes(stickyNotes);
  openEditor(note.id);
  setEditMode(true);
}

/* ============ WIRING ============ */
md.addEventListener('input', function(){ onEdit(); syncFromCaret(); });
md.addEventListener('keyup', syncFromCaret);
md.addEventListener('click', syncFromCaret);
md.addEventListener('scroll', function() {
  if (!editing) return;
  var ratio = md.scrollTop / Math.max(1, md.scrollHeight - md.clientHeight);
  rendered.scrollTop = ratio * (rendered.scrollHeight - rendered.clientHeight);
});

/* tick checkboxes in read (or preview) mode */
renderOut.addEventListener('click', function(e) {
  // Click-to-copy on inline `code` chips
  var chip = e.target.closest && e.target.closest('code.copyable');
  if (chip) {
    doCopy(chip.getAttribute('data-copy') || chip.textContent);
    chip.classList.remove('copied'); void chip.offsetWidth; chip.classList.add('copied');
    setTimeout(function(){ chip.classList.remove('copied'); }, 1100);
    return;
  }
  var li = e.target.closest && e.target.closest('li.chk');
  if (!li) return;
  var line = parseInt(li.getAttribute('data-line'), 10);
  var lines = md.value.split('\n');
  if (lines[line] != null) {
    lines[line] = lines[line].replace(/\[( |x)\]/, function(_, c){ return c === 'x' ? '[ ]' : '[x]'; });
    md.value = lines.join('\n');
    onEdit();
  }
});

// Copy text to OS clipboard (prefer IPC → Electron clipboard; fall back to Web API)
function doCopy(text) {
  try {
    if (window.notesAPI && window.notesAPI.copyText) { window.notesAPI.copyText(String(text)); return; }
  } catch (e) { /* fall through */ }
  try { navigator.clipboard.writeText(String(text)); } catch (e) { /* ignore */ }
}

document.getElementById('readBtn').addEventListener('click', function(){ setEditMode(false); });
document.getElementById('editBtn').addEventListener('click', function(){ setEditMode(true); });
document.getElementById('backBtn').addEventListener('click', function() {
  if (currentTaskId) { window.notesAPI.close(); return; }
  closeEditor();
});
document.getElementById('helpBtn').addEventListener('click', function(){ helper.classList.toggle('open'); });
document.getElementById('helperClose').addEventListener('click', function(){ helper.classList.remove('open'); });
document.getElementById('tabOutline').addEventListener('click', function() {
  this.classList.add('on'); document.getElementById('tabSyntax').classList.remove('on');
  panelOutline.classList.remove('hidden'); document.getElementById('panelSyntax').classList.add('hidden');
});
document.getElementById('tabSyntax').addEventListener('click', function() {
  this.classList.add('on'); document.getElementById('tabOutline').classList.remove('on');
  document.getElementById('panelSyntax').classList.remove('hidden'); panelOutline.classList.add('hidden');
});
Array.prototype.forEach.call(document.querySelectorAll('.cheat-row'), function(row) {
  row.addEventListener('click', function(){ insertSnippet(row.getAttribute('data-ins')); });
});

document.getElementById('addNoteBtn').addEventListener('click', function(){ if (!currentTaskId) addNote(); });
document.getElementById('archiveBtn').addEventListener('click', openArchive);

/* ---- share / export ---- */
var shareMenu = document.getElementById('shareMenu');
var exportToast = document.getElementById('exportToast');
function showToast(msg, isErr) {
  exportToast.textContent = msg;
  exportToast.className = 'export-toast show' + (isErr ? ' err' : '');
  setTimeout(function(){ exportToast.className = 'export-toast' + (isErr ? ' err' : ''); }, 2600);
}
function exportContext() {
  flushSave();
  if (currentTaskId) return { title: (editorTitle.textContent || 'Task note'), text: md.value };
  var note = getActiveNote();
  return { title: note ? noteTitle(note) : 'Note', text: md.value };
}
function closeShareMenu() { shareMenu.classList.remove('open'); }
document.getElementById('shareBtn').addEventListener('click', function(e){
  e.stopPropagation();
  shareMenu.classList.toggle('open');
});
document.addEventListener('click', function(e){
  if (shareMenu.classList.contains('open') && !e.target.closest('.share-wrap')) closeShareMenu();
});
document.getElementById('exportMdBtn').addEventListener('click', function(){
  closeShareMenu();
  var ctx = exportContext();
  showToast('Exporting Markdown…');
  window.notesAPI.exportMd(ctx).then(function(r){
    if (r && r.ok) showToast('✓ Saved ' + baseName(r.path));
    else if (r && r.canceled) exportToast.className = 'export-toast';
    else showToast('Export failed', true);
  });
});
document.getElementById('exportPdfBtn').addEventListener('click', function(){
  closeShareMenu();
  var ctx = exportContext();
  showToast('Rendering PDF…');
  window.notesAPI.exportPdf(ctx).then(function(r){
    if (r && r.ok) showToast('✓ Saved ' + baseName(r.path));
    else if (r && r.canceled) exportToast.className = 'export-toast';
    else showToast('PDF export failed', true);
  });
});
function baseName(p){ return p ? String(p).replace(/\\/g, '/').split('/').pop() : ''; }

/* window controls (both bars) */
function closeWin(){ flushSave(); window.notesAPI.close(); }
document.getElementById('minBtnBoard').addEventListener('click', closeWin);
document.getElementById('closeBtnBoard').addEventListener('click', closeWin);
document.getElementById('minBtnEd').addEventListener('click', closeWin);
document.getElementById('closeBtnEd').addEventListener('click', closeWin);

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
  editorTitle.textContent = data.taskText ? data.taskText.slice(0, 40) : 'Task Note';
  document.getElementById('backBtn').style.display = 'none';
  renderColorPick();
  window.notesAPI.getTaskNote(data.taskId).then(function(text) {
    md.value = text || '';
    setEditMode(false);
    refresh();
    boardView.classList.remove('active');
    editorView.classList.add('active');
  });
});

window.notesAPI.onLoadGlobalNote(function() {
  if (currentTaskId) window.notesAPI.saveTaskNote(currentTaskId, md.value);
  currentTaskId = null;
  document.getElementById('backBtn').style.display = '';
  editorView.classList.remove('active');
  boardView.classList.add('active');
  renderBoard();
});

/* ============ THEME + SNAP ============ */
window.notesAPI.onThemeUpdate(function(t) {
  var r = document.documentElement;
  r.style.setProperty('--bg', t.winBg || t.bg);
  r.style.setProperty('--surface', t.surface);
  if (t.surface2) r.style.setProperty('--surface2', t.surface2);
  r.style.setProperty('--text', t.text);
  r.style.setProperty('--text-dim', t.textDim);
  if (t.accent) r.style.setProperty('--accent', t.accent);
  if (t.green) r.style.setProperty('--green', t.green);
  if (t.red) r.style.setProperty('--red', t.red);
  if (t.yellow) r.style.setProperty('--yellow', t.yellow);
  /* keep --ink dark; brutal theme wants ink borders regardless */
});

window.notesAPI.onSnapGlow(function() {
  document.body.classList.remove('snap-glow');
  void document.body.offsetWidth;
  document.body.classList.add('snap-glow');
});
