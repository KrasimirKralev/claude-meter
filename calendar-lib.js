'use strict';
// The calendar's logic with no window attached: when reminders fire, which dates a repeating event falls
// on, and how an event from Google Calendar becomes one of ours.

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
// What an event gets when nothing was chosen, like one added from the phone.
const DEFAULT_REMINDER = 15;
// Past this, a reminder that was missed while the computer slept is no longer news.
const MISSED_WINDOW = 30 * MINUTE;
const OVERDUE_AFTER = 5 * MINUTE;
const OVERDUE_UNTIL = HOUR;
const SCHEDULE_AHEAD = 24 * HOUR;
const MAX_ALL_DAY_SPAN = 31;
const REPEAT_DAYS = { daily: 1, weekly: 7, biweekly: 14 };

function pad(n) {
  return String(n).padStart(2, '0');
}

function dayString(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Noon, so adding days can't land on the wrong date across a clock change.
function parseDay(text) {
  const [year, month, day] = text.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

function addDays(text, count) {
  const d = parseDay(text);
  d.setDate(d.getDate() + count);
  return dayString(d);
}

function beforeText(minutes) {
  if (minutes === 60) return 'In 1 hour';
  if (minutes > 60 && minutes % 60 === 0) return `In ${minutes / 60} hours`;
  return `In ${minutes} minutes`;
}

// The moments an event calls for attention. Null means its owner asked for no reminder. An older
// synced event says `true`. An all-day event has no moment of its own, so it gets one morning note.
function reminderStages(evt) {
  const chosen = evt.reminder === true ? DEFAULT_REMINDER : evt.reminder;
  if (typeof chosen !== 'number' || chosen < 0) return [];
  if (!evt.time) return [{ key: 'allday', minsBefore: 0, body: 'Today' }];
  const stages = [];
  if (chosen > 0) stages.push({ key: `${chosen}m`, minsBefore: chosen, body: beforeText(chosen) });
  if (chosen > 10) stages.push({ key: '10m', minsBefore: 10, body: beforeText(10) });
  stages.push({ key: '0m', minsBefore: 0, body: 'Starting NOW' });
  return stages;
}

function eventMoment(evt) {
  return new Date(`${evt.date}T${evt.time || '09:00'}`).getTime();
}

// What to do about one event right now: stages to fire, stages to set timers for, and missed ones to
// forget. Of the stages missed while asleep only the latest fires, or waking up would bring a burst.
function planReminders(evt, now, fired) {
  const plan = { fireNow: null, later: [], forget: [], overdue: false };
  if (evt.done || !evt.date) return plan;
  const moment = eventMoment(evt);
  if (Number.isNaN(moment)) return plan;
  const stages = reminderStages(evt);
  const missed = [];
  for (const stage of stages) {
    if (fired.has(stage.key)) continue;
    const delay = moment - stage.minsBefore * MINUTE - now;
    if (delay >= 0) {
      if (delay <= SCHEDULE_AHEAD) plan.later.push({ stage, delay });
    } else {
      missed.push(stage);
    }
  }
  if (missed.length > 0) {
    if (now - moment < MISSED_WINDOW) {
      plan.fireNow = missed[missed.length - 1];
      plan.forget = missed.slice(0, -1).map((stage) => stage.key);
    } else {
      plan.forget = missed.map((stage) => stage.key);
    }
  }
  const past = now - moment;
  plan.overdue = Boolean(evt.time) && stages.length > 0 && !fired.has('overdue')
    && past > OVERDUE_AFTER && past < OVERDUE_UNTIL;
  return plan;
}

function lastDayOf(year, month) {
  return new Date(year, month + 1, 0, 12).getDate();
}

// The dates a repeating event falls on after its first, from `from` up to `until` inclusive. Monthly
// ones count from the first date, so one on the 31st lands on each month's last day and comes back.
function occurrences(baseDate, recurrence, from, until) {
  const dates = [];
  if (recurrence === 'monthly') {
    const base = parseDay(baseDate);
    for (let step = 1; step < 1200; step += 1) {
      const year = base.getFullYear() + Math.floor((base.getMonth() + step) / 12);
      const month = (base.getMonth() + step) % 12;
      const date = dayString(new Date(year, month, Math.min(base.getDate(), lastDayOf(year, month)), 12));
      if (date > until) break;
      if (date >= from) dates.push(date);
    }
    return dates;
  }
  const gap = REPEAT_DAYS[recurrence] || 7;
  for (let date = addDays(baseDate, gap); date <= until; date = addDays(date, gap)) {
    if (date >= from) dates.push(date);
  }
  return dates;
}

// The joinable meeting address on a Google event: Meet's own link, then a video entry point, then a
// known provider's address in the location or description.
function extractMeetLink(item) {
  if (item.hangoutLink) return item.hangoutLink;
  const entries = item.conferenceData && item.conferenceData.entryPoints;
  if (Array.isArray(entries)) {
    const video = entries.find((e) => e && e.entryPointType === 'video' && e.uri);
    if (video) return video.uri;
  }
  const known = /https:\/\/[^\s<>"']*(?:meet\.google\.com|zoom\.us|teams\.microsoft\.com|teams\.live\.com|webex\.com|whereby\.com|meet\.jit\.si)[^\s<>"']*/i;
  for (const field of [item.location, item.description]) {
    if (typeof field === 'string') {
      const match = field.match(known);
      if (match) return match[0];
    }
  }
  return null;
}

const GOOGLE_COLORS = {
  1: '#7986cb', 2: '#33b679', 3: '#8e24aa', 4: '#e67c73', 5: '#f6bf26', 6: '#f4511e',
  7: '#039be5', 8: '#616161', 9: '#3f51b5', 10: '#0b8043', 11: '#d50000',
};

function googleColor(colorId) {
  return GOOGLE_COLORS[colorId] || '#4285f4';
}

// One Google event as our events: none if its owner declined it, and one a day if it's all-day and
// spans several, because Google gives the day after the last as its end.
function mapGoogleItem(item, email) {
  if (!item || !item.start) return [];
  if (item.status === 'cancelled') return [];
  const self = Array.isArray(item.attendees) ? item.attendees.find((a) => a && a.self) : null;
  if (self && self.responseStatus === 'declined') return [];

  const base = {
    title: item.summary || '(No title)',
    color: item.colorId ? googleColor(item.colorId) : '#4285f4',
    reminder: DEFAULT_REMINDER,
    recurrence: null,
    recurringParentId: null,
    googleEventId: item.id,
    googleAccount: email,
    googleLink: item.htmlLink || null,
    meetLink: extractMeetLink(item),
    createdAt: Date.now(),
    isGoogleEvent: true,
  };
  const id = `gcal:${email}:${item.id}`;

  if (item.start.dateTime) {
    const start = new Date(item.start.dateTime);
    const end = item.end && item.end.dateTime ? new Date(item.end.dateTime) : null;
    return [{
      ...base,
      id,
      date: dayString(start),
      time: `${pad(start.getHours())}:${pad(start.getMinutes())}`,
      duration: end ? Math.round((end.getTime() - start.getTime()) / MINUTE) : null,
    }];
  }

  const first = (item.start.date || '').slice(0, 10);
  if (!first) return [];
  const last = item.end && item.end.date ? addDays(item.end.date.slice(0, 10), -1) : first;
  const events = [];
  for (let date = first, n = 0; date <= last && n < MAX_ALL_DAY_SPAN; date = addDays(date, 1), n += 1) {
    events.push({ ...base, id: n === 0 ? id : `${id}:${date}`, date, time: null, duration: null });
  }
  return events.length > 0 ? events : [{ ...base, id, date: first, time: null, duration: null }];
}

// The events after a Google sync: everything local, fresh events from accounts that answered, the old
// ones from accounts that failed, and the done marks people set, which Google doesn't know about.
function mergeGoogleEvents(existing, fresh, failedEmails) {
  const failed = new Set(failedEmails);
  const doneIds = new Set(existing.filter((e) => e.isGoogleEvent && e.done).map((e) => e.id));
  const kept = existing.filter((e) => !e.isGoogleEvent || failed.has(e.googleAccount));
  return kept.concat(fresh.map((e) => (doneIds.has(e.id) ? { ...e, done: true } : e)));
}

module.exports = {
  DEFAULT_REMINDER,
  addDays,
  extractMeetLink,
  mapGoogleItem,
  mergeGoogleEvents,
  occurrences,
  planReminders,
  reminderStages,
};
