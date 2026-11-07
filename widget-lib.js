// What the widget and dashboard say about usage, with no window attached. Loaded with a <script> tag
// in the renderers and with require() in the tests, so it stays plain ES5 like them.
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WidgetLib = factory();
})(this, function() {
  var CELLS = 12;
  var HOUR = 3600000;
  var WEEK = 168 * HOUR;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function clampPct(pct) {
    var n = Number(pct);
    if (!isFinite(n)) return 0;
    return Math.max(0, Math.min(100, n));
  }

  function filledCells(pct) {
    var value = clampPct(pct);
    var filled = Math.round(value / 100 * CELLS);
    return value > 0 && filled === 0 ? 1 : filled;
  }

  // The server's own grade when it sent one, because Claude Code never re-grades a row.
  function meterClass(meter) {
    if (!meter) return '';
    if (meter.severity === 'critical') return 'danger';
    if (meter.severity === 'warning') return 'warning';
    if (meter.severity === 'normal') return '';
    if (meter.pct >= 85) return 'danger';
    if (meter.pct >= 60) return 'warning';
    return '';
  }

  function shortLabel(meter) {
    var label = (meter && meter.label) || '';
    if (!label) return 'Limit';
    var scoped = /\(([^)]+)\)/.exec(label);
    var text = scoped ? scoped[1] : label.replace(/^Current /, '');
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  // Which meter leads a row. Plans with a session limit run into that one first.
  function rowMeters(usage) {
    if (!usage) return { main: null, subs: [] };
    var all = [usage.session, usage.weekAll, usage.weekSonnet]
      .concat(usage.otherLimits || [])
      .filter(function(meter) { return !!meter; });
    return { main: all[0] || null, subs: all.slice(1) };
  }

  function clockText(date) {
    var hours = date.getHours();
    var mins = date.getMinutes();
    return (hours % 12 || 12) + (mins ? ':' + (mins < 10 ? '0' : '') + mins : '') + (hours >= 12 ? 'pm' : 'am');
  }

  function refillText(resetsAt, now) {
    if (!resetsAt) return '';
    var date = new Date(resetsAt);
    if (isNaN(date.getTime())) return '';
    var diff = date.getTime() - now;
    if (diff <= 0) return 'now';
    if (diff < 24 * HOUR) {
      var hours = Math.floor(diff / HOUR);
      var mins = Math.floor((diff % HOUR) / 60000);
      if (hours > 0) return 'in ' + hours + 'h ' + mins + 'm';
      if (mins > 0) return 'in ' + mins + 'm';
      return 'in ' + Math.max(1, Math.floor(diff / 1000)) + 's';
    }
    // A weekday is only unambiguous within the coming week.
    if (diff < 7 * 24 * HOUR) return DAYS[date.getDay()] + ', ' + clockText(date);
    return MONTHS[date.getMonth()] + ' ' + date.getDate() + ', ' + clockText(date);
  }

  function isLoggedOut(account) {
    return !!account.needsLogin || !!(account.login && account.login.state === 'out');
  }

  function limitedMins(account, now) {
    if (!account.rateLimitedUntil) return 0;
    var diff = account.rateLimitedUntil - now;
    return diff > 0 ? Math.max(1, Math.round(diff / 60000)) : 0;
  }

  function fullWord(meter, name) {
    var word = meter.pct >= 100 ? 'full' : 'nearly full';
    if (name) return name + ' ' + word + '.';
    return word.charAt(0).toUpperCase() + word.slice(1) + '.';
  }

  // Everything a row shows: its meters, plus up to two pieces of text beside them. The alert goes
  // first, because it is what the reader has to act on.
  function rowState(account, now) {
    var meters = rowMeters(account.usage);
    var limited = limitedMins(account, now);
    var state = { status: 'ok', main: meters.main, subs: meters.subs, alert: '', detail: '' };
    var login = account.login;

    if (isLoggedOut(account)) {
      state.status = 'out';
      state.alert = 'Logged out.';
    } else if (login && login.state === 'warn' && login.short) {
      state.alert = 'Login ends ' + login.short + '.';
    }

    if (limited) {
      if (state.status === 'ok') state.status = 'limited';
      state.detail = 'Rate limited, retrying in ' + limited + 'm';
    }

    if (!meters.main) {
      if (state.status === 'ok') state.status = account.error ? 'error' : 'waiting';
      if (!state.detail && state.status !== 'out') state.detail = account.error || 'Waiting for first sync';
      return state;
    }

    if (!state.alert) {
      if (meterClass(meters.main) === 'danger') {
        state.alert = fullWord(meters.main);
      } else {
        for (var i = 0; i < meters.subs.length; i++) {
          if (meterClass(meters.subs[i]) === 'danger') {
            state.alert = fullWord(meters.subs[i], shortLabel(meters.subs[i]));
            break;
          }
        }
      }
    }
    if (!state.detail) {
      var refill = refillText(meters.main.resetsAt, now);
      // A row's main meter has no label of its own, so a session limit has to say what is refilling.
      if (refill) state.detail = (meters.main === account.usage.session ? 'Session refills ' : 'Refills ') + refill;
    }
    return state;
  }

  function usable(account) {
    return !isLoggedOut(account) && !!rowMeters(account.usage).main;
  }

  function fullest(account) {
    var meters = rowMeters(account.usage);
    return meters.subs.reduce(function(top, meter) { return Math.max(top, meter.pct); }, meters.main.pct);
  }

  // One sentence's worth of facts: who has the most room, and when room comes back next.
  function answerParts(accounts, now) {
    var live = (accounts || []).filter(usable);
    if (live.length === 0) return null;

    var most = null;
    var full = false;
    if (live.length > 1) {
      var levels = live.map(fullest);
      var lowest = Math.min.apply(null, levels);
      var highest = Math.max.apply(null, levels);
      full = lowest >= 100;
      if (!full && lowest < highest) most = live[levels.indexOf(lowest)].name;
    }

    var next = null;
    var nextAt = Infinity;
    live.forEach(function(account) {
      var resetsAt = rowMeters(account.usage).main.resetsAt;
      var at = resetsAt ? new Date(resetsAt).getTime() : NaN;
      if (at > now && at < nextAt) { nextAt = at; next = account; }
    });
    return {
      most: most,
      full: full,
      nextName: next && live.length > 1 ? next.name : null,
      nextText: next ? refillText(rowMeters(next.usage).main.resetsAt, now) : '',
    };
  }

  // The dashboard's week ahead: one mark per account that refills inside it, alternating above and
  // below the line so close neighbours don't collide.
  function timelineMarks(accounts, now) {
    var marks = [];
    (accounts || []).forEach(function(account, index) {
      var main = rowMeters(account.usage).main;
      var at = main && main.resetsAt ? new Date(main.resetsAt).getTime() : NaN;
      if (!(at > now) || at - now > WEEK) return;
      marks.push({ index: index, name: account.name, at: at, x: (at - now) / WEEK * 100, text: refillText(main.resetsAt, now) });
    });
    marks.sort(function(a, b) { return a.at - b.at; });
    marks.forEach(function(mark, i) {
      mark.lane = i % 2 ? 'down' : 'up';
      // Past this point a label would run off the right edge, so it reads leftwards instead.
      mark.flip = mark.x > 75;
    });
    return marks;
  }

  // This week's history points, as percentages of the week that has passed.
  function weekSeries(points, resetsAt) {
    if (!points || !resetsAt) return [];
    var end = new Date(resetsAt).getTime();
    if (isNaN(end)) return [];
    var start = end - WEEK;
    return points
      .filter(function(point) { return point.ts >= start && point.ts <= end && point.weekAll != null; })
      .map(function(point) {
        return {
          x: Math.round((point.ts - start) / WEEK * 1000) / 10,
          all: point.weekAll,
          scoped: point.weekSonnet == null ? null : point.weekSonnet,
        };
      });
  }

  return {
    CELLS: CELLS,
    answerParts: answerParts,
    filledCells: filledCells,
    meterClass: meterClass,
    refillText: refillText,
    rowMeters: rowMeters,
    rowState: rowState,
    shortLabel: shortLabel,
    timelineMarks: timelineMarks,
    weekSeries: weekSeries,
  };
});
