// What the Plan section says about tasks, events and habits, with no window attached. Loaded with a
// <script> in the renderers and with require() in the tests, so it stays plain ES5 like them.
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlanLib = factory();
})(this, function() {
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
  var EVENT_COLORS = { blue: '#60a5fa', green: '#4ade80', orange: '#fb923c', red: '#f87171', purple: '#c084fc' };
  var REPEAT_WORDS = { daily: 'Daily', weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly' };

  function pad(n) { return String(n).padStart(2, '0'); }

  function dayString(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  // Noon, so that adding days can't land on the wrong date across a clock change.
  function parseDay(text) {
    var parts = String(text).split('-');
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 12);
  }

  function addDays(text, count) {
    var date = parseDay(text);
    date.setDate(date.getDate() + count);
    return dayString(date);
  }

  // The Monday of that day's week.
  function weekStart(text) {
    var date = parseDay(text);
    var day = date.getDay();
    return addDays(text, -(day === 0 ? 6 : day - 1));
  }

  function weekDays(text) {
    var start = weekStart(text);
    var days = [];
    for (var i = 0; i < 7; i++) days.push(addDays(start, i));
    return days;
  }

  function weekLabel(text) {
    var start = parseDay(weekStart(text));
    var end = parseDay(addDays(weekStart(text), 6));
    return MONTHS[start.getMonth()] + ' ' + start.getDate() + ' – ' + MONTHS[end.getMonth()] + ' ' + end.getDate();
  }

  // Whole weeks starting on Monday, including the days of the months around it.
  function monthGrid(year, month) {
    var first = dayString(new Date(year, month, 1, 12));
    var days = [];
    var current = weekStart(first);
    do {
      for (var i = 0; i < 7; i++) {
        days.push({ date: current, day: parseDay(current).getDate(), inMonth: parseDay(current).getMonth() === month });
        current = addDays(current, 1);
      }
    } while (parseDay(current).getMonth() === month);
    return days;
  }

  function monthTitle(year, month) {
    return MONTHS_LONG[month] + ' ' + year;
  }

  function dayTitle(text) {
    var date = parseDay(text);
    return DAYS_LONG[date.getDay()] + ', ' + MONTHS[date.getMonth()] + ' ' + date.getDate();
  }

  function isValidDay(text) {
    return typeof text === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(text) && dayString(parseDay(text)) === text;
  }

  function eventColor(color) {
    if (typeof color === 'string' && /^#[0-9a-f]{3,8}$/i.test(color)) return color;
    return EVENT_COLORS[color] || EVENT_COLORS.blue;
  }

  function eventMs(evt) {
    return new Date(evt.date + 'T' + (evt.time || '23:59')).getTime();
  }

  function isLate(evt, now) {
    return !evt.done && eventMs(evt) < now;
  }

  // Done last, then all-day ones, then by time.
  function sortEvents(events) {
    return events.slice().sort(function(a, b) {
      if (Boolean(a.done) !== Boolean(b.done)) return a.done ? 1 : -1;
      if (!a.time !== !b.time) return a.time ? 1 : -1;
      return (a.time || '').localeCompare(b.time || '');
    });
  }

  function eventsOn(events, date) {
    return sortEvents((events || []).filter(function(evt) { return evt.date === date; }));
  }

  function durationText(minutes) {
    if (!minutes) return '';
    if (minutes < 60) return minutes + 'm';
    var hours = Math.floor(minutes / 60);
    var rest = minutes % 60;
    return rest ? hours + 'h ' + rest + 'm' : hours + 'h';
  }

  function reminderText(minutes) {
    if (typeof minutes !== 'number') return '';
    if (minutes === 0) return 'Reminder at the time';
    return 'Reminder ' + durationText(minutes) + ' before';
  }

  function repeatText(evt) {
    if (evt.recurrence) return REPEAT_WORDS[evt.recurrence] || 'Repeats';
    return evt.recurringParentId ? 'Repeats' : '';
  }

  // A meeting link: the one a sync found, or any https address pasted into the title.
  function meetingLink(evt) {
    if (evt.meetLink) return evt.meetLink;
    // Anyone can send an invite, so an address in a synced title is only words.
    if (evt.isGoogleEvent) return null;
    var match = typeof evt.title === 'string' && evt.title.match(/https:\/\/[^\s<>"']+/);
    return match ? match[0] : null;
  }

  // Where a link really goes, shown beside its button because the title leaves the address out.
  function linkHost(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (error) {
      return '';
    }
  }

  // The title to show. A pasted meeting link becomes the Join button, so it needn't show twice.
  function eventTitle(evt) {
    var title = String(evt.title || '');
    var without = title.replace(/https:\/\/[^\s<>"']+/g, ' ').replace(/\s+/g, ' ').trim();
    return without || title;
  }

  // "Design review 3pm 1h" into a title, a time and a duration.
  function parseQuickAdd(input) {
    var title = input;
    var time = null;
    var duration = null;
    var twelve = input.match(/\b(\d{1,2})(:\d{2})?\s*(am|pm)\b/i);
    if (twelve) {
      var hour = parseInt(twelve[1], 10);
      var minute = twelve[2] ? parseInt(twelve[2].slice(1), 10) : 0;
      var period = twelve[3].toLowerCase();
      if (hour >= 1 && hour <= 12 && minute < 60) {
        if (period === 'pm' && hour !== 12) hour += 12;
        if (period === 'am' && hour === 12) hour = 0;
        time = pad(hour) + ':' + pad(minute);
        title = title.replace(twelve[0], ' ');
      }
    } else {
      var clock = input.match(/\b(\d{1,2}):(\d{2})\b/);
      if (clock && parseInt(clock[1], 10) <= 23 && parseInt(clock[2], 10) <= 59) {
        time = pad(parseInt(clock[1], 10)) + ':' + clock[2];
        title = title.replace(clock[0], ' ');
      }
    }
    var span = title.match(/\b(\d+(?:\.\d+)?)\s*(hours|hour|hrs|hr|h|mins|min|m)\b/i);
    if (span) {
      var amount = parseFloat(span[1]);
      duration = Math.round(span[2].charAt(0).toLowerCase() === 'h' ? amount * 60 : amount);
      title = title.replace(span[0], ' ');
    }
    title = title.replace(/\s+/g, ' ').replace(/^[\s,-]+|[\s,-]+$/g, '');
    return { title: title || input.trim(), time: time, duration: duration };
  }

  function priorityOf(task) {
    return task.priority in PRIORITY_RANK ? task.priority : 'medium';
  }

  // Highest priority first, then the order the person dragged them into.
  function sortTasks(tasks) {
    return tasks.slice().sort(function(a, b) {
      var rank = PRIORITY_RANK[priorityOf(a)] - PRIORITY_RANK[priorityOf(b)];
      if (rank !== 0) return rank;
      return (a.order || 0) - (b.order || 0);
    });
  }

  function splitTasks(tasks) {
    var list = tasks || [];
    return {
      active: sortTasks(list.filter(function(t) { return !t.done; })),
      done: list.filter(function(t) { return t.done; }),
    };
  }

  function nextPriority(priority) {
    return priority === 'low' ? 'medium' : (priority === 'medium' ? 'high' : 'low');
  }

  // A row moved next to rows of another priority takes on theirs, or sorting would put it straight back.
  function priorityAfterMove(orderedTasks, movedId) {
    for (var i = 0; i < orderedTasks.length; i++) {
      if (orderedTasks[i].id !== movedId) continue;
      var moved = priorityOf(orderedTasks[i]);
      var before = i > 0 ? priorityOf(orderedTasks[i - 1]) : null;
      var after = i < orderedTasks.length - 1 ? priorityOf(orderedTasks[i + 1]) : null;
      if (before === moved || after === moved) return moved;
      return before || after || moved;
    }
    return null;
  }

  function dueInfo(task, now) {
    if (!task.dueDate || !isValidDay(task.dueDate)) return null;
    var today = dayString(new Date(now));
    var due = new Date(task.dueDate + 'T' + (task.dueTime || '23:59')).getTime();
    var date = parseDay(task.dueDate);
    var dateText = MONTHS[date.getMonth()] + ' ' + date.getDate();
    var withTime = task.dueTime ? ' · ' + task.dueTime : '';
    if (!task.done && due < now) return { tone: 'late', text: 'Overdue · ' + dateText + withTime };
    if (task.dueDate === today) return { tone: 'today', text: 'Today' + withTime };
    return { tone: '', text: dateText + withTime };
  }

  function countText(count, one, many) {
    return count + ' ' + (count === 1 ? one : many);
  }

  // One row of the habits board: every day of the month, with what it is and what can be done with it.
  function habitDays(doneDays, year, month, today) {
    var total = new Date(year, month + 1, 0).getDate();
    var days = [];
    for (var d = 1; d <= total; d++) {
      var date = year + '-' + pad(month + 1) + '-' + pad(d);
      days.push({
        date: date,
        day: d,
        done: (doneDays || []).indexOf(date) !== -1,
        today: date === today,
        future: date > today,
      });
    }
    return days;
  }

  // Consecutive days up to today. A day not ticked yet today doesn't break it.
  function habitStreak(doneDays, today) {
    var set = {};
    (doneDays || []).forEach(function(day) { set[day] = true; });
    var current = set[today] ? today : addDays(today, -1);
    var streak = 0;
    while (set[current]) {
      streak += 1;
      current = addDays(current, -1);
    }
    return streak;
  }

  return {
    addDays: addDays,
    countText: countText,
    dayString: dayString,
    dayTitle: dayTitle,
    dueInfo: dueInfo,
    durationText: durationText,
    eventColor: eventColor,
    eventTitle: eventTitle,
    eventsOn: eventsOn,
    habitDays: habitDays,
    habitStreak: habitStreak,
    isLate: isLate,
    isValidDay: isValidDay,
    linkHost: linkHost,
    meetingLink: meetingLink,
    monthGrid: monthGrid,
    monthTitle: monthTitle,
    nextPriority: nextPriority,
    parseDay: parseDay,
    parseQuickAdd: parseQuickAdd,
    priorityAfterMove: priorityAfterMove,
    priorityOf: priorityOf,
    reminderText: reminderText,
    repeatText: repeatText,
    sortEvents: sortEvents,
    splitTasks: splitTasks,
    weekDays: weekDays,
    weekLabel: weekLabel,
    weekStart: weekStart,
  };
});
