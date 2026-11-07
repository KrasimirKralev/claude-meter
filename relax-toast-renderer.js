// The heads-up before a Relax break: a 30 s countdown with Later and Skip.
// Main owns the timing; this only counts down to the startsAt it was given.
(function () {
  var countEl = document.getElementById('count');
  var subEl = document.getElementById('sub');
  var segsEl = document.getElementById('segs');
  var startsAt = 0;
  var timer = null;
  var answered = false;

  function tick() {
    var secs = Math.max(0, Math.ceil((startsAt - Date.now()) / 1000));
    countEl.textContent = String(secs);
    if (secs <= 0 && timer) { clearInterval(timer); timer = null; }
  }

  function answer(fn) {
    if (answered) return;
    answered = true;
    fn();
  }

  document.getElementById('startBtn').addEventListener('click', function () { answer(window.relaxAPI.startNow); });
  document.getElementById('laterBtn').addEventListener('click', function () { answer(window.relaxAPI.later); });
  document.getElementById('skipBtn').addEventListener('click', function () { answer(window.relaxAPI.skip); });

  window.relaxAPI.onToast(function (data) {
    startsAt = data.startsAt;
    var mins = data.minutes;
    subEl.textContent = (mins === 1 ? '1 min' : mins + ' min') + ' · screens go calm' + (data.music ? ' · music' : '');
    while (segsEl.firstChild) segsEl.removeChild(segsEl.firstChild);
    for (var i = 0; i < data.total; i++) {
      var seg = document.createElement('span');
      seg.className = 'seg' + (i < data.done ? ' f' : '');
      segsEl.appendChild(seg);
    }
    tick();
    if (!timer) timer = setInterval(tick, 250);
  });
})();
