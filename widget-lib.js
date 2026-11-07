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

  // Short enough to sit on one line beside "Can't read usage."
  function ageText(at, now) {
    var mins = Math.max(0, Math.round((now - at) / 60000));
    if (mins < 1) return 'Under 1m old';
    if (mins < 60) return mins + 'm old';
    var hours = Math.round(mins / 60);
    if (hours < 48) return hours + 'h old';
    return Math.round(hours / 24) + 'd old';
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
    } else if (limited) {
      state.status = 'limited';
    } else if (account.error) {
      state.status = 'error';
    }
    if (limited) state.detail = "Can't read usage, retrying in " + limited + 'm';

    if (!meters.main) {
      if (state.status === 'ok') state.status = 'waiting';
      if (!state.detail && state.status !== 'out') state.detail = account.error || 'Waiting for first sync';
      return state;
    }

    // Old numbers shown as current would mislead, so a failed read says so before anything else.
    if (state.status === 'error') {
      state.alert = "Can't read usage.";
      state.detail = account.lastSuccessfulSync ? ageText(account.lastSuccessfulSync, now) : account.error;
      return state;
    }
    // Logged out: a refill time means nothing until someone logs back in.
    if (state.status === 'out') {
      if (account.lastSuccessfulSync) state.detail = ageText(account.lastSuccessfulSync, now);
      return state;
    }

    var full = null;
    if (meterClass(meters.main) === 'danger') {
      full = meters.main;
      if (!state.alert) state.alert = fullWord(meters.main);
    } else {
      for (var i = 0; i < meters.subs.length && !full; i++) {
        if (meterClass(meters.subs[i]) === 'danger') {
          full = meters.subs[i];
          if (!state.alert) state.alert = fullWord(full, shortLabel(full));
        }
      }
    }
    if (!state.alert && login && login.state === 'warn' && login.short) state.alert = 'Login ends ' + login.short + '.';
    if (!state.detail) {
      // The time belongs to the limit the alert names, which may not be the main one.
      var source = full || meters.main;
      var refill = refillText(source.resetsAt, now);
      if (refill) state.detail = (source === account.usage.session ? 'Session refills ' : 'Refills ') + refill;
    }
    return state;
  }

  // Failed reads don't count: their numbers may be old, so they can't be called the roomiest.
  function usable(account) {
    return !isLoggedOut(account) && !account.error && !!rowMeters(account.usage).main;
  }

  function fullest(account) {
    var meters = rowMeters(account.usage);
    return meters.subs.reduce(function(top, meter) { return Math.max(top, meter.pct); }, meters.main.pct);
  }

  // One sentence's worth of facts: who has the most room, and when room comes back next.
  function answerParts(accounts, now) {
    var all = accounts || [];
    var live = all.filter(usable);
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
    var nextMain = next ? rowMeters(next.usage).main : null;
    return {
      most: most,
      // A claim about "most room" or "full" only covers the accounts that could be read.
      of: (most || full) && live.length < all.length ? live.length : null,
      full: full,
      nextName: next && all.length > 1 ? next.name : null,
      nextKind: next && nextMain === next.usage.session ? 'session' : '',
      nextText: next ? refillText(nextMain.resetsAt, now) : '',
    };
  }

  // The weekly meter stands unlabelled, as in the design. Anything else has to say what it is.
  function labelMeter(meter, usage) {
    if (meter === usage.weekAll && !usage.session) return '';
    return shortLabel(meter);
  }

  function refillDiffers(meter, main) {
    if (!meter.resetsAt || !main.resetsAt) return false;
    return Math.abs(new Date(meter.resetsAt).getTime() - new Date(main.resetsAt).getTime()) > 60000;
  }

  // A column heading is only true if it holds for every row. Otherwise the rows name themselves.
  function boardHeads(accounts) {
    var rows = (accounts || []).filter(function(account) { return !!rowMeters(account.usage).main; });
    if (rows.length === 0) return { main: 'Weekly, all models', sub: 'Weekly', labelMain: false, labelSub: false };
    var mains = rows.map(function(account) { return shortLabel(rowMeters(account.usage).main); });
    var sameMain = mains.every(function(label) { return label === mains[0]; });
    var subs = rows.map(function(account) {
      return rowMeters(account.usage).subs.map(shortLabel).join('+');
    });
    var firstSub = rowMeters(rows[0].usage).subs[0];
    var weeklySub = !!firstSub && /^Current week/.test(firstSub.label || '');
    var sameSub = subs.every(function(label) { return label === subs[0]; }) && subs[0].indexOf('+') === -1 && subs[0] !== '';
    var mainName = mains[0] === 'All models' ? 'Weekly, all models' : mains[0];
    return {
      main: sameMain ? mainName : 'Main limit',
      sub: sameSub ? (weeklySub ? 'Weekly, ' + subs[0] : subs[0]) : 'Other limits',
      labelMain: !sameMain,
      labelSub: !sameSub,
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

  function localDay(now) {
    var d = new Date(now);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // Today's unfinished events still worth showing, then the next future ones, soonest first.
  function upcomingEvents(events, now) {
    var today = localDay(now);
    return (events || [])
      .filter(function(evt) {
        if (evt.done || evt.date < today) return false;
        if (evt.date > today || !evt.time) return true;
        // Something that started in the last half hour is probably still going on.
        return new Date(evt.date + 'T' + evt.time).getTime() >= now - 30 * 60000;
      })
      .sort(function(a, b) {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        // Timed first: an all-day holiday must not hide the next meeting all day.
        if (!a.time && b.time) return 1;
        if (a.time && !b.time) return -1;
        return (a.time || '').localeCompare(b.time || '');
      });
  }

  function eventTimeText(evt, now) {
    if (evt.date !== localDay(now)) {
      var parts = evt.date.split('-');
      return MONTHS[parseInt(parts[1], 10) - 1] + ' ' + parseInt(parts[2], 10);
    }
    if (!evt.time) return 'All day';
    var diff = new Date(evt.date + 'T' + evt.time).getTime() - now;
    if (diff <= 0) return 'Now';
    if (diff < 60 * 60000) return 'in ' + Math.round(diff / 60000) + 'm';
    return evt.time;
  }

  function money(minor, decimals, currency) {
    var d = (typeof decimals === 'number' && decimals >= 0) ? decimals : 2;
    var v = (Number(minor || 0) / Math.pow(10, d)).toFixed(d);
    if (currency === 'BGN') return v + ' лв';
    var sym = { EUR: '€', USD: '$', GBP: '£', JPY: '¥' }[currency] || ((currency || '') + ' ');
    return sym + v;
  }

  var COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

  // One line for all accounts, so "not enabled" isn't repeated once per account.
  function extraSummary(accounts) {
    var known = (accounts || []).filter(function(account) { return !!account.usage; });
    if (known.length === 0) return '';
    var enabled = known.filter(function(account) { return account.usage.extraUsage && account.usage.extraUsage.enabled; });
    if (enabled.length === 0) {
      if (known.length === 1 && accounts.length === 1) return 'Extra usage is off.';
      var count = COUNT_WORDS[known.length] || known.length;
      if (known.length < accounts.length) {
        return 'Extra usage is off on the ' + count + (known.length === 1 ? ' account' : ' accounts') + ' with numbers.';
      }
      return known.length === 2 ? 'Extra usage is off on both accounts.' : 'Extra usage is off on all ' + count + ' accounts.';
    }
    return 'Extra usage this month: ' + enabled.map(function(account) {
      var extra = account.usage.extraUsage;
      var spent = extra.usedMinor != null ? money(extra.usedMinor, extra.decimals, extra.currency) : '—';
      var limit = extra.limitMinor != null ? ' of ' + money(extra.limitMinor, extra.decimals, extra.currency) : '';
      return (known.length > 1 ? account.name + ' ' : '') + spent + limit;
    }).join(', ') + '.';
  }

  function editedText(updatedAt, now) {
    if (!updatedAt) return '';
    var today = new Date(now);
    today.setHours(0, 0, 0, 0);
    var at = new Date(updatedAt);
    if (at >= today) return 'Edited today';
    if (at.getTime() >= today.getTime() - 24 * HOUR) return 'Edited yesterday';
    return 'Edited ' + MONTHS[at.getMonth()] + ' ' + at.getDate();
  }

  return {
    CELLS: CELLS,
    boardHeads: boardHeads,
    labelMeter: labelMeter,
    refillDiffers: refillDiffers,
    editedText: editedText,
    eventTimeText: eventTimeText,
    extraSummary: extraSummary,
    localDay: localDay,
    money: money,
    upcomingEvents: upcomingEvents,
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
