// node --test test/smart-text.test.js
const test = require('node:test');
const assert = require('node:assert');
const { parseSmartText } = require('../smart-text');

// Saturday, 7 November 2026, at noon.
const NOW = new Date(2026, 10, 7, 12, 0);
const parse = (text, now = NOW) => parseSmartText(text, now);

test('plain words stay exactly as they were, with no date', () => {
  for (const text of [
    'Buy 2.5 kg rice',
    'Pay 50.50 to Ana',
    'Meeting 1.5 hours',
    'Turn on the lights',
    'Look at the logs',
    'Report February 30',
    'Use 1/2 cup of sugar',
    'Buy milk 3.50',
    'Buy milk 3.10',
    'Buy 2 m of cable',
    'Call 15.30',
    'Monday-ish plans', // the day name is part of a longer word
  ]) {
    const result = parse(text);
    assert.strictEqual(result.title, text, text);
    assert.strictEqual(result.date, null, text);
    assert.strictEqual(result.time, null, text);
    assert.strictEqual(result.duration, null, text);
  }
});

test('words around a date stay: in Bulgarian too', () => {
  assert.deepStrictEqual(parse('Среща в офиса утре'), { title: 'Среща в офиса', date: '2026-11-08', time: null, duration: null, priority: 'medium' });
});

test('relative days, with day after tomorrow not read as tomorrow', () => {
  assert.strictEqual(parse('Pay today').date, '2026-11-07');
  assert.strictEqual(parse('Pay tomorrow').date, '2026-11-08');
  const after = parse('Dentist day after tomorrow 3pm');
  assert.deepStrictEqual([after.title, after.date, after.time], ['Dentist', '2026-11-09', '15:00']);
  assert.strictEqual(parse('Dentist the day after tomorrow').title, 'Dentist');
  assert.strictEqual(parse('Среща днес').date, '2026-11-07');
  assert.strictEqual(parse('Среща вдругиден').date, '2026-11-09');
});

test('the usual example', () => {
  assert.deepStrictEqual(parse('Meeting tomorrow 3pm 1h'), { title: 'Meeting', date: '2026-11-08', time: '15:00', duration: 60, priority: 'medium' });
});

test('a day name is the next one to come, and never today', () => {
  assert.strictEqual(parse('Call monday').date, '2026-11-09');
  assert.strictEqual(parse('Call on friday').date, '2026-11-13');
  assert.strictEqual(parse('Call on friday').title, 'Call');
  assert.strictEqual(parse('Call saturday').date, '2026-11-14');
  assert.strictEqual(parse('Среща в понеделник').date, '2026-11-09');
  assert.strictEqual(parse('Среща в понеделник').title, 'Среща');
});

test('next friday is the one in next week', () => {
  assert.strictEqual(parse('Call next friday').date, '2026-11-13'); // from a Saturday: 6 days
  const monday = new Date(2026, 10, 2, 12);
  assert.strictEqual(parse('Call next friday', monday).date, '2026-11-13'); // from a Monday: 11 days
  assert.strictEqual(parse('Call next monday', monday).date, '2026-11-09');
  const sunday = new Date(2026, 10, 8, 12);
  assert.strictEqual(parse('Call next monday', sunday).date, '2026-11-09');
  assert.strictEqual(parse('Call next sunday', sunday).date, '2026-11-15');
});

test('in so many days or weeks', () => {
  assert.strictEqual(parse('Renew in 3 days').date, '2026-11-10');
  assert.strictEqual(parse('Renew in 2 weeks').date, '2026-11-21');
  assert.strictEqual(parse('Renew in 2 weeks').title, 'Renew');
});

test('dates with month names roll to next year once past', () => {
  assert.strictEqual(parse('Trip March 25').date, '2027-03-25');
  assert.strictEqual(parse('Trip 25 December').date, '2026-12-25');
  assert.strictEqual(parse('Trip on December 25').title, 'Trip');
});

test('numeric dates: dots are day.month, slashes go by what is possible, past ones roll forward', () => {
  const lunch = parse('Lunch 10.11 18:00');
  assert.deepStrictEqual([lunch.title, lunch.date, lunch.time], ['Lunch', '2026-11-10', '18:00']);
  assert.strictEqual(parse('Lunch 1/15').date, '2027-01-15');
  assert.strictEqual(parse('Lunch 25/12').date, '2026-12-25');
  assert.strictEqual(parse('Lunch 25.12.2027').date, '2027-12-25');
  assert.strictEqual(parse('Lunch on 3/25 with Ana').date, '2027-03-25');
  assert.strictEqual(parse('Lunch 2028-02-29').date, '2028-02-29');
  assert.strictEqual(parse('Lunch 2027-02-29').date, null);
});

test('times: am and pm, 24 hours, and nonsense left alone', () => {
  assert.strictEqual(parse('Lunch tomorrow 3:30pm').time, '15:30');
  assert.strictEqual(parse('Lunch tomorrow 12am').time, '00:00');
  assert.strictEqual(parse('Lunch tomorrow 12pm').time, '12:00');
  assert.strictEqual(parse('Lunch tomorrow 15:00').time, '15:00');
  assert.strictEqual(parse('Среща утре в 15:00').title, 'Среща');
  assert.strictEqual(parse('Lunch tomorrow at 15.30').time, '15:30');
  const bad = parse('Standup tomorrow 10:99');
  assert.deepStrictEqual([bad.title, bad.date, bad.time], ['Standup 10:99', '2026-11-08', null]);
  assert.strictEqual(parse('Party tomorrow 13pm').time, null);
});

test('a time with no date is the next time it comes round', () => {
  assert.deepStrictEqual(parse('Dentist 3pm'), { title: 'Dentist', date: '2026-11-07', time: '15:00', duration: null, priority: 'medium' });
  assert.strictEqual(parse('Dentist 9am').date, '2026-11-08');
  assert.strictEqual(parse('Dentist 12:00').date, '2026-11-08'); // that very minute has come
});

test('durations, once there is a date or time for them to belong to', () => {
  assert.strictEqual(parse('Workshop tomorrow 1.5h').duration, 90);
  assert.strictEqual(parse('Workshop tomorrow 30m').duration, 30);
  assert.strictEqual(parse('Workshop tomorrow 2 hours').duration, 120);
  assert.strictEqual(parse('Среща утре 2 часа').duration, 120);
  assert.strictEqual(parse('Среща утре 45 мин').duration, 45);
});

test('priority words and marks go, and raise the priority', () => {
  assert.deepStrictEqual([parse('Pay rent!!').title, parse('Pay rent!!').priority], ['Pay rent', 'high']);
  assert.deepStrictEqual([parse('Urgent call Ana').title, parse('Urgent call Ana').priority], ['call Ana', 'high']);
  assert.strictEqual(parse('Pay rent!').priority, 'medium');
  assert.strictEqual(parse('Pay rent!').title, 'Pay rent!');
});

test('nothing but a date keeps the words as the title', () => {
  assert.strictEqual(parse('tomorrow 3pm').title, 'tomorrow 3pm');
  assert.strictEqual(parse('tomorrow 3pm').date, '2026-11-08');
});
