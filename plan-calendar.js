/* The calendar: one component, in the Calendar panel beside the widget and in the dashboard's Plan
   section. Wide, it shows the month beside the day. Narrow, a week strip that can open the month.
   It holds no data of its own: the host hands it the events and an api to act on them. */
(function(global) {
  'use strict';
  var L = global.PlanLib;
  var UI = global.UI;
  var el = UI.el;
  var LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  var SHORT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var COLORS = ['blue', 'green', 'orange', 'red', 'purple'];
  var DURATIONS = [['', 'No length'], ['15', '15 min'], ['30', '30 min'], ['45', '45 min'], ['60', '1 hour'], ['90', '1.5 hours'], ['120', '2 hours'], ['180', '3 hours']];
  var REMINDERS = [['', 'No reminder'], ['0', 'At the time'], ['5', '5 min before'], ['15', '15 min before'], ['30', '30 min before'], ['60', '1 hour before']];
  var REPEATS = [['', 'Does not repeat'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['biweekly', 'Every 2 weeks'], ['monthly', 'Monthly']];
  var CLOCK_MS = 60000;

  function today() {
    return L.dayString(new Date());
  }

  function selectOf(options, value, label) {
    var select = el('select', 'field');
    select.setAttribute('aria-label', label);
    options.forEach(function(option) {
      var node = el('option', null, option[1]);
      node.value = option[0];
      select.appendChild(node);
    });
    select.value = value === null || value === undefined ? '' : String(value);
    if (select.selectedIndex < 0) select.selectedIndex = 0;
    return select;
  }

  function mount(root, api) {
    var events = [];
    var selected = today();
    var lastToday = selected;
    var viewYear = L.parseDay(selected).getFullYear();
    var viewMonth = L.parseDay(selected).getMonth();
    var monthOpen = false;
    // null: no form. 'new': adding. Otherwise the id of the event being edited.
    var editing = null;
    var draggingId = null;

    root.classList.add('pc');

    var monthBox = el('section', 'pc-month card');
    monthBox.setAttribute('aria-label', 'Month');
    var weekBox = el('section', 'pc-week');
    weekBox.setAttribute('aria-label', 'Week');
    var side = el('div', 'pc-left');
    side.appendChild(weekBox);
    side.appendChild(monthBox);

    var dayBox = el('section', 'pc-day');
    var dayHead = el('div', 'pc-dayhead');
    var formBox = el('div', 'pc-formbox');
    var list = el('div', 'pc-events');
    var quick = el('form', 'pc-quick');
    var quickInput = el('input', 'field');
    quickInput.maxLength = 100;
    quickInput.placeholder = 'Quick add, like "Design review 3pm 1h"';
    quickInput.setAttribute('aria-label', 'Quick add an event to this day');
    quick.appendChild(quickInput);
    dayBox.appendChild(dayHead);
    dayBox.appendChild(formBox);
    dayBox.appendChild(list);
    dayBox.appendChild(quick);

    var inner = el('div', 'pc-inner');
    inner.appendChild(side);
    inner.appendChild(dayBox);
    root.appendChild(inner);

    quick.addEventListener('submit', function(e) {
      e.preventDefault();
      var raw = quickInput.value.trim();
      if (!raw) return;
      var parsed = L.parseQuickAdd(raw);
      api.addEvent({ title: parsed.title, date: selected, time: parsed.time, duration: parsed.duration, color: 'blue', reminder: 15, recurrence: null });
      quickInput.value = '';
    });

    function select(date) {
      selected = date;
      var day = L.parseDay(date);
      viewYear = day.getFullYear();
      viewMonth = day.getMonth();
      if (editing === 'new') editing = null;
      render();
    }

    function moveMonth(delta) {
      viewMonth += delta;
      if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
      if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
      renderMonth();
    }

    function canMove(evt) {
      return Boolean(evt) && !evt.isGoogleEvent;
    }

    function dropTarget(node, date) {
      node.addEventListener('dragover', function(e) {
        if (draggingId === null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        node.classList.add('drop');
      });
      node.addEventListener('dragleave', function() { node.classList.remove('drop'); });
      node.addEventListener('drop', function(e) {
        e.preventDefault();
        node.classList.remove('drop');
        if (draggingId === null) return;
        api.moveEvent(draggingId, date);
        draggingId = null;
        select(date);
      });
    }

    function dots(date) {
      var row = el('span', 'pc-dots');
      L.eventsOn(events, date).filter(function(evt) { return !evt.done; }).slice(0, 3).forEach(function(evt) {
        var dot = el('i');
        dot.style.background = L.eventColor(evt.color);
        row.appendChild(dot);
      });
      return row;
    }

    function dayLabel(date) {
      var count = L.eventsOn(events, date).filter(function(evt) { return !evt.done; }).length;
      return L.dayTitle(date) + (date === today() ? ', today' : '') + (count ? ', ' + L.countText(count, 'event', 'events') : '');
    }

    function renderMonth() {
      UI.clear(monthBox);
      var head = el('div', 'pc-monthhead');
      var prev = UI.iconButton('prev', 'Previous month');
      prev.addEventListener('click', function() { moveMonth(-1); });
      var next = UI.iconButton('next', 'Next month');
      next.addEventListener('click', function() { moveMonth(1); });
      head.appendChild(prev);
      head.appendChild(el('h2', null, L.monthTitle(viewYear, viewMonth)));
      head.appendChild(next);
      monthBox.appendChild(head);

      var grid = el('div', 'pc-grid');
      LETTERS.forEach(function(letter, index) {
        var cell = el('span', 'pc-letter', letter);
        cell.title = SHORT_DAYS[index];
        grid.appendChild(cell);
      });
      var now = today();
      L.monthGrid(viewYear, viewMonth).forEach(function(day) {
        var cell = el('button', 'pc-cell' + (day.inMonth ? '' : ' other') + (day.date === now ? ' today' : '') + (day.date === selected ? ' on' : ''));
        cell.type = 'button';
        cell.setAttribute('aria-label', dayLabel(day.date));
        cell.setAttribute('aria-pressed', day.date === selected ? 'true' : 'false');
        cell.appendChild(el('span', 'pc-num', String(day.day)));
        cell.appendChild(dots(day.date));
        cell.addEventListener('click', function() {
          monthOpen = false;
          select(day.date);
        });
        dropTarget(cell, day.date);
        grid.appendChild(cell);
      });
      monthBox.appendChild(grid);
    }

    function renderWeek() {
      UI.clear(weekBox);
      var nav = el('div', 'pc-weeknav');
      var prev = UI.iconButton('prev', 'Previous week');
      prev.addEventListener('click', function() { select(L.addDays(selected, -7)); });
      var next = UI.iconButton('next', 'Next week');
      next.addEventListener('click', function() { select(L.addDays(selected, 7)); });
      var label = el('button', 'btn small bare pc-weeklabel');
      label.type = 'button';
      label.setAttribute('aria-expanded', monthOpen ? 'true' : 'false');
      label.title = monthOpen ? 'Hide the month' : 'Show the month';
      label.appendChild(document.createTextNode(L.weekLabel(selected)));
      label.appendChild(UI.icon('down'));
      label.addEventListener('click', function() {
        monthOpen = !monthOpen;
        render();
      });
      nav.appendChild(prev);
      nav.appendChild(label);
      nav.appendChild(next);
      weekBox.appendChild(nav);

      var strip = el('div', 'pc-strip');
      var now = today();
      L.weekDays(selected).forEach(function(date, index) {
        var cell = el('button', 'pc-cell' + (date === now ? ' today' : '') + (date === selected ? ' on' : ''));
        cell.type = 'button';
        cell.setAttribute('aria-label', dayLabel(date));
        cell.setAttribute('aria-pressed', date === selected ? 'true' : 'false');
        cell.appendChild(el('span', 'pc-letter', LETTERS[index]));
        cell.appendChild(el('span', 'pc-num', String(L.parseDay(date).getDate())));
        cell.appendChild(dots(date));
        cell.addEventListener('click', function() { select(date); });
        dropTarget(cell, date);
        strip.appendChild(cell);
      });
      weekBox.appendChild(strip);
      root.classList.toggle('month-open', monthOpen);
    }

    function renderDayHead() {
      UI.clear(dayHead);
      var title = el('h2', null, L.dayTitle(selected));
      dayHead.appendChild(title);
      if (selected === today()) {
        dayHead.appendChild(el('span', 'tag candy', 'Today'));
      } else {
        var back = el('button', 'btn small', 'Today');
        back.type = 'button';
        back.addEventListener('click', function() { select(today()); });
        dayHead.appendChild(back);
      }
      var add = el('button', 'btn small primary pc-new');
      add.type = 'button';
      add.appendChild(UI.icon('plus'));
      add.appendChild(document.createTextNode('Event'));
      add.setAttribute('aria-label', 'New event');
      add.addEventListener('click', function() {
        editing = editing === 'new' ? null : 'new';
        renderForm();
      });
      dayHead.appendChild(add);
    }

    function buildEvent(evt, now) {
      var late = L.isLate(evt, now);
      var row = el('article', 'pc-ev' + (evt.done ? ' is-done' : '') + (late ? ' late' : ''));
      row.setAttribute('data-id', evt.id);

      var check = el('button', 'check' + (evt.done ? ' on' : ''));
      check.type = 'button';
      check.setAttribute('role', 'checkbox');
      check.setAttribute('aria-checked', evt.done ? 'true' : 'false');
      check.setAttribute('aria-label', (evt.done ? 'Mark not done: ' : 'Mark done: ') + evt.title);
      check.appendChild(UI.icon('check'));
      check.addEventListener('click', function() { api.toggleEvent(evt.id); });
      row.appendChild(check);

      var when = el('div', 'pc-when');
      if (late && evt.time) when.appendChild(el('span', 'tag late', 'Late'));
      when.appendChild(document.createTextNode(evt.time || 'All day'));
      row.appendChild(when);

      var swatch = el('i', 'pc-swatch');
      swatch.style.background = L.eventColor(evt.color);
      row.appendChild(swatch);

      var body = el('div', 'pc-body');
      body.appendChild(el('div', 'pc-title', evt.title));
      var meta = [];
      var length = L.durationText(evt.duration);
      if (length) meta.push(length);
      var repeats = L.repeatText(evt);
      if (repeats) meta.push(repeats);
      var reminder = L.reminderText(evt.reminder);
      if (reminder) meta.push(reminder);
      if (evt.isGoogleEvent) meta.push(evt.googleAccount ? 'Google, ' + evt.googleAccount : 'Google');
      if (meta.length) body.appendChild(el('div', 'pc-meta', meta.join(' · ')));
      row.appendChild(body);

      var actions = el('div', 'pc-actions');
      var link = L.meetingLink(evt);
      if (link) {
        var join = el('button', 'btn small primary', 'Join');
        join.type = 'button';
        join.title = link;
        join.addEventListener('click', function() { api.openExternal(link); });
        actions.appendChild(join);
      } else if (evt.isGoogleEvent && evt.googleLink) {
        var open = UI.iconButton('link', 'Open in Google Calendar');
        open.addEventListener('click', function() { api.openExternal(evt.googleLink); });
        actions.appendChild(open);
      }
      if (!evt.isGoogleEvent) {
        var edit = UI.iconButton('edit', 'Edit this event');
        edit.addEventListener('click', function() {
          editing = evt.id;
          renderForm();
        });
        actions.appendChild(edit);
        var del = UI.iconButton('trash', 'Delete this event', 'danger');
        del.addEventListener('click', function() { api.deleteEvent(evt.id); });
        actions.appendChild(del);
      }
      row.appendChild(actions);

      // A synced event lives in Google, so a move here wouldn't last.
      if (canMove(evt)) {
        row.draggable = true;
        row.addEventListener('dragstart', function(e) {
          draggingId = evt.id;
          e.dataTransfer.setData('text/plain', evt.id);
          e.dataTransfer.effectAllowed = 'move';
          row.classList.add('dragging');
        });
        row.addEventListener('dragend', function() {
          draggingId = null;
          row.classList.remove('dragging');
        });
      }
      return row;
    }

    function renderEvents() {
      UI.clear(list);
      var day = L.eventsOn(events, selected);
      if (day.length === 0) {
        list.appendChild(el('div', 'empty', 'Nothing on this day.'));
        return;
      }
      var now = Date.now();
      day.forEach(function(evt) { list.appendChild(buildEvent(evt, now)); });
    }

    function labelled(text, control) {
      var label = el('label', 'pc-field');
      label.appendChild(el('span', null, text));
      label.appendChild(control);
      return label;
    }

    function renderForm() {
      UI.clear(formBox);
      if (editing === null) return;
      var evt = editing === 'new' ? null : events.filter(function(e) { return e.id === editing; })[0];
      if (editing !== 'new' && !evt) {
        editing = null;
        return;
      }
      var form = el('form', 'pc-form card raised');
      form.noValidate = true;
      form.appendChild(el('h3', null, evt ? 'Edit event' : 'New event'));

      var title = el('input', 'field');
      title.maxLength = 100;
      title.placeholder = 'What is it?';
      title.setAttribute('aria-label', 'Title');
      title.value = evt ? evt.title : '';
      form.appendChild(title);

      var whenRow = el('div', 'pc-formrow');
      var date = el('input', 'field');
      date.type = 'date';
      date.value = evt ? evt.date : selected;
      var time = el('input', 'field');
      time.type = 'time';
      time.value = evt && evt.time ? evt.time : '';
      whenRow.appendChild(labelled('Date', date));
      whenRow.appendChild(labelled('Time, blank for all day', time));
      form.appendChild(whenRow);

      var moreRow = el('div', 'pc-formrow');
      var duration = selectOf(DURATIONS, evt ? evt.duration : null, 'Length');
      var reminder = selectOf(REMINDERS, evt ? evt.reminder : 15, 'Reminder');
      moreRow.appendChild(labelled('Length', duration));
      moreRow.appendChild(labelled('Reminder', reminder));
      var repeat = null;
      if (!evt) {
        repeat = selectOf(REPEATS, null, 'Repeat');
        moreRow.appendChild(labelled('Repeat', repeat));
      }
      form.appendChild(moreRow);

      var colorRow = el('fieldset', 'pc-colors');
      colorRow.appendChild(el('legend', null, 'Colour'));
      var chosen = evt && COLORS.indexOf(evt.color) !== -1 ? evt.color : 'blue';
      var chips = [];
      COLORS.forEach(function(color) {
        var chip = el('button', 'pc-color');
        chip.type = 'button';
        chip.style.background = L.eventColor(color);
        chip.setAttribute('aria-label', color);
        chip.setAttribute('aria-pressed', color === chosen ? 'true' : 'false');
        chip.addEventListener('click', function() {
          chosen = color;
          chips.forEach(function(other) { other.setAttribute('aria-pressed', other === chip ? 'true' : 'false'); });
        });
        chips.push(chip);
        colorRow.appendChild(chip);
      });
      form.appendChild(colorRow);

      var problem = el('p', 'pc-problem');
      problem.setAttribute('role', 'alert');
      form.appendChild(problem);

      var buttons = el('div', 'pc-formbtns');
      var save = el('button', 'btn primary', evt ? 'Save' : 'Add event');
      save.type = 'submit';
      var cancel = el('button', 'btn bare', 'Cancel');
      cancel.type = 'button';
      var close = function() {
        editing = null;
        renderForm();
      };
      cancel.addEventListener('click', close);
      buttons.appendChild(save);
      buttons.appendChild(cancel);
      form.appendChild(buttons);

      form.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') close();
      });
      form.addEventListener('submit', function(e) {
        e.preventDefault();
        var text = title.value.trim();
        if (!text) {
          problem.textContent = 'Give the event a title.';
          title.focus();
          return;
        }
        if (!L.isValidDay(date.value)) {
          problem.textContent = 'Choose a date.';
          date.focus();
          return;
        }
        var data = {
          title: text,
          date: date.value,
          time: time.value || null,
          duration: duration.value ? parseInt(duration.value, 10) : null,
          color: chosen,
          reminder: reminder.value !== '' ? parseInt(reminder.value, 10) : null,
        };
        var moveTo = data.date;
        if (evt) {
          data.id = evt.id;
          api.updateEvent(data);
        } else {
          data.recurrence = repeat.value || null;
          api.addEvent(data);
        }
        close();
        select(moveTo);
      });
      formBox.appendChild(form);
      title.focus();
    }

    function render() {
      lastToday = today();
      renderWeek();
      renderMonth();
      renderDayHead();
      renderEvents();
    }

    // A day boundary or an event's time can pass while this sits open.
    var clock = setInterval(function() {
      if (!root.isConnected) {
        clearInterval(clock);
        return;
      }
      if (today() !== lastToday && selected === lastToday) select(today());
      else renderEvents();
    }, CLOCK_MS);

    render();

    return {
      update: function(next) {
        events = Array.isArray(next) ? next : [];
        render();
        if (editing !== null && editing !== 'new' && !events.some(function(e) { return e.id === editing; })) {
          editing = null;
          renderForm();
        }
      },
      render: render,
      selectDay: select,
    };
  }

  global.PlanCalendar = { mount: mount };
})(window);
