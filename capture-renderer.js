/* Quick-capture popover — Enter saves to the Inbox note, Esc dismisses. */
var input = document.getElementById('in');
var goBtn = document.getElementById('go');

function submit() {
  var v = input.value.trim();
  if (!v) { window.captureAPI.close(); return; }
  window.captureAPI.submit(v);
}

input.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') { e.preventDefault(); submit(); }
  else if (e.key === 'Escape') { e.preventDefault(); window.captureAPI.close(); }
});
goBtn.addEventListener('click', submit);
setTimeout(function(){ input.focus(); }, 30);
