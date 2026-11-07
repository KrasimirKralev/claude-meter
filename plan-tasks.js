/* The task list: one component, in the Tasks panel beside the widget and in the dashboard's Plan
   section. It holds no data of its own: the host hands it the tasks and an api to act on them. */
(function(global) {
  'use strict';
  var L = global.PlanLib;
  var UI = global.UI;
  var el = UI.el;
  var PRIORITY_WORDS = { high: 'High', medium: 'Medium', low: 'Low' };
  var NOTE_MS = 3500;

  function mount(root, api, options) {
    var opts = options || {};
    var tasks = [];
    var schedulingId = null;
    var doneOpen = Boolean(opts.doneOpen);
    var draggedId = null;
    var noteTimer = null;

    root.classList.add('pt');

    var form = el('form', 'pt-add');
    var input = el('input', 'field');
    input.maxLength = 200;
    input.placeholder = 'Add a task, like "Call Sam tomorrow 3pm"';
    input.setAttribute('aria-label', 'New task');
    var addBtn = el('button', 'btn primary', 'Add');
    addBtn.type = 'submit';
    form.appendChild(input);
    form.appendChild(addBtn);
    root.appendChild(form);

    var note = el('p', 'pt-note');
    note.setAttribute('role', 'status');
    root.appendChild(note);

    var scroller = el('div', 'pt-scroll');
    var activeList = el('div', 'pt-list card');
    var doneHead = el('div', 'pt-donehead');
    var doneList = el('div', 'pt-list card pt-done');
    scroller.appendChild(activeList);
    scroller.appendChild(doneHead);
    scroller.appendChild(doneList);
    root.appendChild(scroller);

    function say(text) {
      note.textContent = text;
      clearTimeout(noteTimer);
      noteTimer = setTimeout(function() { note.textContent = ''; }, NOTE_MS);
    }

    form.addEventListener('submit', function(e) {
      e.preventDefault();
      var text = input.value.trim();
      if (!text) return;
      input.disabled = true;
      addBtn.disabled = true;
      var done = function() {
        input.disabled = false;
        addBtn.disabled = false;
        input.value = '';
        input.focus();
      };
      api.smartAdd(text).then(function(result) {
        if (result && result.event && result.parsed && result.parsed.date) {
          var parsed = result.parsed;
          say('Added, with a calendar event on ' + L.dayTitle(parsed.date) + (parsed.time ? ' at ' + parsed.time : '') + '.');
        }
        done();
      }, function() {
        api.addTask(text);
        done();
      });
    });

    function currentOrder() {
      var ids = [];
      var rows = activeList.querySelectorAll('.pt-row[data-id]');
      for (var i = 0; i < rows.length; i++) ids.push(rows[i].getAttribute('data-id'));
      return ids;
    }

    function taskById(id) {
      return tasks.filter(function(t) { return String(t.id) === String(id); })[0];
    }

    // Ids go back as the tasks hold them, because an old task may have a numeric one.
    function commitOrder(movedId) {
      var ordered = currentOrder().map(taskById).filter(Boolean);
      var moved = taskById(movedId);
      if (moved) {
        var priority = L.priorityAfterMove(ordered, moved.id);
        if (priority && priority !== L.priorityOf(moved)) api.setPriority(moved.id, priority);
      }
      api.reorder(ordered.map(function(t) { return t.id; }));
    }

    function buildSchedule(task) {
      var box = el('form', 'pt-schedule');
      var date = el('input', 'field');
      date.type = 'date';
      date.value = task.dueDate && L.isValidDay(task.dueDate) ? task.dueDate : L.dayString(new Date());
      date.required = true;
      date.setAttribute('aria-label', 'Date');
      var time = el('input', 'field');
      time.type = 'time';
      time.value = task.dueTime || '';
      time.setAttribute('aria-label', 'Time, optional');
      var save = el('button', 'btn small primary', 'Add to calendar');
      save.type = 'submit';
      var cancel = el('button', 'btn small bare', 'Cancel');
      cancel.type = 'button';
      cancel.addEventListener('click', function() {
        schedulingId = null;
        render();
      });
      box.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
          schedulingId = null;
          render();
        }
      });
      box.addEventListener('submit', function(e) {
        e.preventDefault();
        api.scheduleTask(task.id, date.value, time.value || null).then(function(result) {
          schedulingId = null;
          render();
          if (result && result.alreadyExists) say('This task is already on the calendar.');
          else if (result && result.success) say('On the calendar for ' + L.dayTitle(date.value) + '.');
          else say('That could not be added to the calendar.');
        });
      });
      box.appendChild(date);
      box.appendChild(time);
      box.appendChild(save);
      box.appendChild(cancel);
      setTimeout(function() { date.focus(); }, 0);
      return box;
    }

    function buildRow(task, isDone) {
      var row = el('div', 'pt-row' + (isDone ? ' is-done' : ''));
      row.setAttribute('data-id', String(task.id));

      var check = el('button', 'check' + (task.done ? ' on' : ''));
      check.type = 'button';
      check.setAttribute('role', 'checkbox');
      check.setAttribute('aria-checked', task.done ? 'true' : 'false');
      check.setAttribute('aria-label', (task.done ? 'Mark not done: ' : 'Mark done: ') + task.text);
      check.appendChild(UI.icon('check'));
      check.addEventListener('click', function() { api.toggleTask(task.id); });

      var body = el('div', 'pt-body');
      body.appendChild(el('span', 'pt-text', task.text));
      var due = L.dueInfo(task, Date.now());
      if (due) body.appendChild(el('span', 'pt-due' + (due.tone ? ' ' + due.tone : ''), due.text));

      var actions = el('div', 'pt-actions');
      if (!isDone) {
        var priority = L.priorityOf(task);
        var chip = el('button', 'pt-prio ' + priority, PRIORITY_WORDS[priority]);
        chip.type = 'button';
        chip.title = PRIORITY_WORDS[priority] + ' priority. Click to change.';
        chip.setAttribute('aria-label', chip.title);
        chip.addEventListener('click', function() { api.setPriority(task.id, L.nextPriority(priority)); });
        actions.appendChild(chip);

        var schedule = UI.iconButton('calendar', 'Put on the calendar');
        schedule.setAttribute('aria-expanded', schedulingId === task.id ? 'true' : 'false');
        schedule.addEventListener('click', function() {
          schedulingId = schedulingId === task.id ? null : task.id;
          render();
        });
        actions.appendChild(schedule);
      }
      var noteBtn = UI.iconButton('note', 'Open this task\'s note');
      noteBtn.addEventListener('click', function() { api.openTaskNote(task.id, task.text); });
      actions.appendChild(noteBtn);
      var del = UI.iconButton('trash', 'Delete this task', 'danger');
      del.addEventListener('click', function() { api.deleteTask(task.id); });
      actions.appendChild(del);

      if (!isDone) {
        var grip = UI.iconButton('grip', 'Move. Drag it, or press the up and down arrows.', 'pt-grip');
        grip.addEventListener('keydown', function(e) {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
          e.preventDefault();
          var sibling = e.key === 'ArrowUp' ? row.previousElementSibling : row.nextElementSibling;
          if (!sibling || !sibling.classList.contains('pt-row')) return;
          if (e.key === 'ArrowUp') activeList.insertBefore(row, sibling);
          else activeList.insertBefore(sibling, row);
          grip.focus();
          commitOrder(task.id);
        });
        row.appendChild(grip);

        row.draggable = true;
        row.addEventListener('dragstart', function(e) {
          draggedId = task.id;
          row.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(task.id));
        });
        row.addEventListener('dragend', function() {
          row.classList.remove('dragging');
          var moved = draggedId;
          draggedId = null;
          if (moved !== null) commitOrder(moved);
          render();
        });
        row.addEventListener('dragover', function(e) {
          if (draggedId === null) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          var dragged = activeList.querySelector('.pt-row.dragging');
          if (!dragged || dragged === row) return;
          var box = row.getBoundingClientRect();
          var before = e.clientY < box.top + box.height / 2;
          activeList.insertBefore(dragged, before ? row : row.nextSibling);
        });
      }
      row.appendChild(check);
      row.appendChild(body);
      row.appendChild(actions);
      return row;
    }

    function render() {
      // A rebuild during a drag would take the row out from under the pointer.
      if (draggedId !== null) return;
      var split = L.splitTasks(tasks);
      var focusId = document.activeElement && document.activeElement.closest
        ? document.activeElement.closest('.pt-row')
        : null;
      var keepFocus = focusId && activeList.contains(focusId) ? focusId.getAttribute('data-id') : null;
      var keepLabel = keepFocus ? document.activeElement.getAttribute('aria-label') : null;

      UI.clear(activeList);
      if (split.active.length === 0) {
        activeList.appendChild(el('div', 'empty', 'Nothing to do. Add a task above.'));
      }
      split.active.forEach(function(task) {
        activeList.appendChild(buildRow(task, false));
        if (schedulingId === task.id) activeList.appendChild(buildSchedule(task));
      });

      UI.clear(doneHead);
      UI.clear(doneList);
      doneHead.hidden = split.done.length === 0;
      doneList.hidden = split.done.length === 0 || !doneOpen;
      if (split.done.length > 0) {
        var toggle = el('button', 'btn small bare');
        toggle.type = 'button';
        toggle.setAttribute('aria-expanded', doneOpen ? 'true' : 'false');
        toggle.appendChild(UI.icon(doneOpen ? 'down' : 'next'));
        toggle.appendChild(document.createTextNode('Done · ' + split.done.length));
        toggle.addEventListener('click', function() {
          doneOpen = !doneOpen;
          render();
        });
        doneHead.appendChild(toggle);
        var clearDone = el('button', 'btn small bare', 'Clear done');
        clearDone.type = 'button';
        clearDone.addEventListener('click', function() { api.clearCompleted(); });
        doneHead.appendChild(clearDone);
        if (doneOpen) split.done.forEach(function(task) { doneList.appendChild(buildRow(task, true)); });
      }

      if (keepFocus) {
        var again = activeList.querySelector('.pt-row[data-id="' + CSS.escape(keepFocus) + '"]');
        var target = again && keepLabel ? again.querySelector('[aria-label="' + CSS.escape(keepLabel) + '"]') : null;
        if (target) target.focus();
      }
      if (opts.onCount) opts.onCount(split.active.length);
    }

    return {
      update: function(next) {
        tasks = Array.isArray(next) ? next : [];
        if (schedulingId !== null && !taskById(schedulingId)) schedulingId = null;
        // Don't take a half-filled schedule form away because something else changed.
        if (schedulingId !== null && root.contains(document.activeElement) && document.activeElement.closest('.pt-schedule')) return;
        render();
      },
      focusInput: function() { input.focus(); },
    };
  }

  global.PlanTasks = { mount: mount };
})(window);
