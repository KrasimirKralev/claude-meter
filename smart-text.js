'use strict';
// Turns what someone typed into a task into a title and, when it clearly names one, a date and time:
// "Meeting tomorrow 3pm 1h". A wrong guess costs more than a missed one, because it changes their words
// and creates a calendar event they didn't ask for. So anything unclear stays in the title.

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const DAYS_EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAYS_BG = ['неделя', 'понеделник', 'вторник', 'сряда', 'четвъртък', 'петък', 'събота'];

// JavaScript's \b only knows Latin letters, so word edges are spelled out for both alphabets.
const START = '(^|[\\s,(])';
const END = '(?=$|[\\s,.)!?])';
// A little word that belongs to the date or time after it, and goes when they go.
const LEAD = '(?:(?:at|on|в|във|на)\\s+)?';

function pad(n) {
  return String(n).padStart(2, '0');
}

function fmtDate(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function addDays(day, count) {
  const d = new Date(day);
  d.setDate(d.getDate() + count);
  return d;
}

// Null when the numbers aren't a real day, like February 30.
function realDate(year, monthIndex, day) {
  const d = new Date(year, monthIndex, day);
  return d.getFullYear() === year && d.getMonth() === monthIndex && d.getDate() === day ? d : null;
}

function nextOccurrence(today, monthIndex, day) {
  let d = realDate(today.getFullYear(), monthIndex, day);
  if (d && d < today) d = realDate(today.getFullYear() + 1, monthIndex, day);
  return d;
}

function regex(body, flags = 'iu') {
  return new RegExp(START + body + END, flags);
}

function parseSmartText(input, now = new Date()) {
  const raw = String(input);
  let text = raw;
  let date = null;
  let time = null;
  let duration = null;
  let priority = 'medium';
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const take = (match) => {
    text = text.slice(0, match.index) + match[1] + ' ' + text.slice(match.index + match[0].length);
  };

  if (/!{2,}/.test(text)) {
    priority = 'high';
    text = text.replace(/!{2,}/g, ' ');
  }
  const urgent = /\b(urgent|important|asap|critical)\b/i;
  if (urgent.test(text)) {
    priority = 'high';
    text = text.replace(new RegExp(urgent.source, 'gi'), ' ');
  }

  const relative = [
    [regex(LEAD + '(?:the\\s+)?day\\s+after\\s+tomorrow'), 2],
    [regex(LEAD + 'tomorrow'), 1],
    [regex(LEAD + 'today'), 0],
    [regex('вдругиден'), 2],
    [regex('утре'), 1],
    [regex('днес'), 0],
  ];
  for (const [re, days] of relative) {
    const match = text.match(re);
    if (match) {
      date = fmtDate(addDays(today, days));
      take(match);
      break;
    }
  }

  if (!date) {
    const week = text.match(regex(LEAD + 'in\\s+(\\d{1,3})\\s+(days?|weeks?)'));
    if (week) {
      const count = parseInt(week[2], 10);
      date = fmtDate(addDays(today, /week/i.test(week[3]) ? count * 7 : count));
      take(week);
    }
  }

  // "friday" is the next one to come. "next friday" is the one in next week, which starts on Monday.
  if (!date) {
    for (let index = 0; index < 7 && !date; index += 1) {
      const match = text.match(regex(LEAD + '(next\\s+|следващ[а-я]*\\s+)?(?:' + DAYS_EN[index] + '|' + DAYS_BG[index] + ')'));
      if (!match) continue;
      let ahead = (index - today.getDay() + 7) % 7;
      if (ahead === 0) ahead = 7;
      if (match[2]) {
        const toNextMonday = ((8 - today.getDay()) % 7) || 7;
        ahead = toNextMonday + ((index + 6) % 7);
      }
      date = fmtDate(addDays(today, ahead));
      take(match);
    }
  }

  if (!date) {
    const iso = text.match(regex(LEAD + '(\\d{4})-(\\d{2})-(\\d{2})'));
    if (iso) {
      const d = realDate(parseInt(iso[2], 10), parseInt(iso[3], 10) - 1, parseInt(iso[4], 10));
      if (d) {
        date = fmtDate(d);
        take(iso);
      }
    }
  }

  if (!date) {
    const names = MONTHS.join('|');
    const monthFirst = text.match(regex(LEAD + '(' + names + ')\\s+(\\d{1,2})'));
    const dayFirst = text.match(regex(LEAD + '(\\d{1,2})\\s+(' + names + ')'));
    const found = monthFirst || dayFirst;
    if (found) {
      const month = MONTHS.indexOf((monthFirst ? found[2] : found[3]).toLowerCase());
      const day = parseInt(monthFirst ? found[3] : found[2], 10);
      const d = nextOccurrence(today, month, day);
      if (d) {
        date = fmtDate(d);
        take(found);
      }
    }
  }

  // Numbers alone: "25.03", "3/25". Decimals and fractions look just like these ("Buy 2.5 kg"), so one
  // only counts as a date with nothing but the end of the text, a comma or a time after it, or when
  // it comes with its year. Dots read as day.month, written with two digits each, as dates are here.
  if (!date) {
    const numeric = text.match(/(^|[\s,(])((?:(?:at|on|в|във|на)\s+)?)(\d{1,2})([./])(\d{1,2})(?:\4(\d{4}|\d{2}))?(?=$|[\s,)])/iu);
    if (numeric) {
      const a = parseInt(numeric[3], 10);
      const b = parseInt(numeric[5], 10);
      const dotted = numeric[4] === '.';
      const rest = text.slice(numeric.index + numeric[0].length).trim();
      const clearAfter = rest === '' || rest.startsWith(',') || /^\d{1,2}(:\d{2}|\s*(am|pm))/i.test(rest);
      const shapeOk = !dotted || (numeric[3].length === 2 && numeric[5].length === 2);
      if (numeric[6] || Boolean(numeric[2]) || (clearAfter && shapeOk)) {
        // With a slash, "1/15" can only be month/day and "25/12" can only be day/month.
        const dayFirstOrder = dotted || a > 12;
        const day = dayFirstOrder ? a : b;
        const month = (dayFirstOrder ? b : a) - 1;
        let d = null;
        if (numeric[6]) {
          const year = numeric[6].length === 2 ? 2000 + parseInt(numeric[6], 10) : parseInt(numeric[6], 10);
          d = realDate(year, month, day);
        } else {
          d = nextOccurrence(today, month, day);
        }
        if (d) {
          date = fmtDate(d);
          take(numeric);
        }
      }
    }
  }

  const clock = text.match(regex(LEAD + '(\\d{1,2}):(\\d{2})(?:\\s*(am|pm))?'));
  const twelve = !clock ? text.match(regex(LEAD + '(\\d{1,2})\\s*(am|pm)')) : null;
  // A dotted time needs its little word, or a price would become one.
  const dottedTime = !clock && !twelve ? text.match(regex('(?:at|в|във)\\s+(\\d{1,2})\\.(\\d{2})')) : null;
  const timeMatch = clock || twelve || dottedTime;
  if (timeMatch) {
    let hour = parseInt(timeMatch[2], 10);
    const minute = twelve ? 0 : parseInt(timeMatch[3], 10);
    const period = (clock ? clock[4] || '' : (twelve ? twelve[3] : '')).toLowerCase();
    let valid = minute <= 59;
    if (period) {
      valid = valid && hour >= 1 && hour <= 12;
      if (period === 'pm' && hour !== 12) hour += 12;
      if (period === 'am' && hour === 12) hour = 0;
    } else {
      valid = valid && hour <= 23;
    }
    if (valid) {
      time = pad(hour) + ':' + pad(minute);
      take(timeMatch);
    }
  }

  // A time on its own means the next time that comes round.
  if (time && !date) {
    const [hour, minute] = time.split(':').map(Number);
    const at = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hour, minute);
    date = fmtDate(at <= now ? addDays(today, 1) : today);
  }

  // Without a date or time this is no event, and "2 m of cable" is just words.
  if (date) {
    const span = text.match(regex('(\\d+(?:\\.\\d+)?)\\s*(hours?|hrs?|h|minutes?|mins?|m|часа?|мин)'));
    if (span) {
      const amount = parseFloat(span[2]);
      duration = Math.round(/^(h|час)/i.test(span[3]) ? amount * 60 : amount);
      take(span);
    }
  }

  const title = text.replace(/\s+/g, ' ').replace(/^[\s,:-]+|[\s,:-]+$/g, '').trim();
  return { title: title || raw.trim(), date, time, duration, priority };
}

module.exports = { parseSmartText };
