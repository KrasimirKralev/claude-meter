/* Quick-task popover: Enter adds a task, Esc dismisses. */
var input = document.getElementById('in');
var goBtn = document.getElementById('go');

// The preload has no theme channel yet: this stays on the default look until it does.
if (typeof window.captureAPI.onThemeUpdate === 'function') window.captureAPI.onThemeUpdate(UI.applyTheme);

function submit() {
  var v = input.value.trim();
  if (!v) { window.captureAPI.close(); return; }
  window.captureAPI.submit(v);
}

input.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') { e.preventDefault(); submit(); }
});
// On the document: with the focus on the button, Esc has to close it just the same.
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') { e.preventDefault(); window.captureAPI.close(); }
});
goBtn.addEventListener('click', submit);
setTimeout(function(){ input.focus(); }, 30);
