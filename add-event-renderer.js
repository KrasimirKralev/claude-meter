/* Add Event renderer — smart input with live preview */

var selectedColor = 'blue';
var parseTimer = null;
var lastParsed = null;

var smartInput = document.getElementById('smartInput');
var preview = document.getElementById('preview');

// Live parse as user types
smartInput.addEventListener('input', function() {
  if (parseTimer) clearTimeout(parseTimer);
  parseTimer = setTimeout(function() {
    var text = smartInput.value.trim();
    if (text.length < 2) { preview.classList.remove('visible'); return; }

    window.eventAPI.parseText(text).then(function(parsed) {
      if (!parsed) return;
      lastParsed = parsed;

      document.getElementById('prevTitle').textContent = parsed.title || '-';
      document.getElementById('prevDate').textContent = parsed.date || 'Not detected';
      document.getElementById('prevTime').textContent = parsed.time || 'All day';
      document.getElementById('prevDur').textContent = parsed.duration ? (parsed.duration >= 60 ? (parsed.duration / 60) + 'h' : parsed.duration + 'm') : '-';

      preview.classList.add('visible');

      // Auto-fill manual fields from parsed data
      if (parsed.date) document.getElementById('dateField').value = parsed.date;
      if (parsed.time) document.getElementById('timeField').value = parsed.time;
      if (parsed.duration) document.getElementById('durField').value = String(parsed.duration);
    });
  }, 300);
});

// Enter key to create
smartInput.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') document.getElementById('createBtn').click();
});

// Color picker
var dots = document.querySelectorAll('.color-dot');
for (var i = 0; i < dots.length; i++) {
  (function(dot) {
    dot.addEventListener('click', function() {
      for (var j = 0; j < dots.length; j++) dots[j].classList.remove('active');
      dot.classList.add('active');
      selectedColor = dot.getAttribute('data-color');
    });
  })(dots[i]);
}

// Create button
document.getElementById('createBtn').addEventListener('click', function() {
  var text = smartInput.value.trim();
  if (!text) { smartInput.style.borderColor = 'var(--red)'; return; }

  var title = lastParsed ? lastParsed.title : text;
  var date = document.getElementById('dateField').value;
  var time = document.getElementById('timeField').value || null;
  var dur = document.getElementById('durField').value;
  var rem = document.getElementById('remField').value;
  var rec = document.getElementById('recField').value;

  if (!date) {
    // No date from parser or manual — default to today
    var d = new Date();
    date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  window.eventAPI.createEvent({
    title: title,
    date: date,
    time: time,
    duration: dur ? parseInt(dur, 10) : null,
    color: selectedColor,
    reminder: rem !== '' ? parseInt(rem, 10) : null,
    recurrence: rec || null,
  }).then(function(result) {
    if (result && result.success) {
      var fb = document.getElementById('feedback');
      fb.textContent = '\u2713 Event created!';
      smartInput.value = '';
      preview.classList.remove('visible');
      lastParsed = null;
      // Close after brief feedback
      setTimeout(function() { window.eventAPI.close(); }, 600);
    }
  });
});

// Cancel / Close
document.getElementById('cancelBtn').addEventListener('click', function() {
  window.eventAPI.close();
});
document.getElementById('closeBtn').addEventListener('click', function() {
  window.eventAPI.close();
});

// Pre-set date from calendar
window.eventAPI.onSetDate(function(date) {
  if (date) document.getElementById('dateField').value = date;
});

// Theme
window.eventAPI.onThemeUpdate(function(t) {
  var r = document.documentElement;
  r.style.setProperty('--bg', t.bg);
  r.style.setProperty('--surface', t.surface);
  r.style.setProperty('--surface2', t.surface2);
  r.style.setProperty('--border', t.border);
  r.style.setProperty('--text', t.text);
  r.style.setProperty('--text-dim', t.textDim);
  r.style.setProperty('--accent', t.accent);
  if (t.green) r.style.setProperty('--green', t.green);
  if (t.red) r.style.setProperty('--red', t.red);
});
