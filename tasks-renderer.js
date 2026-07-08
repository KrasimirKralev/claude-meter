/* Tasks window renderer — safe DOM only (no innerHTML) */

var taskData = [];
var PRIORITY_COLORS = { high: '#f87171', medium: '#fb923c', low: '#4ade80' };
var draggedTaskId = null;

function el(tag, cls, text) {
  var node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function updateCounter() {
  var active = 0;
  for (var i = 0; i < taskData.length; i++) {
    if (!taskData[i].done) active++;
  }
  var counter = document.getElementById('counter');
  counter.textContent = active > 0 ? active + ' pending' : '';
}

function sortTasks(tasks) {
  if (!tasks || !tasks.length) return [];
  var priorityVal = { high: 0, medium: 1, low: 2 };
  var active = [];
  var completed = [];
  for (var i = 0; i < tasks.length; i++) {
    if (tasks[i].done) completed.push(tasks[i]);
    else active.push(tasks[i]);
  }
  active.sort(function(a, b) {
    var pa = a.priority in priorityVal ? priorityVal[a.priority] : 1;
    var pb = b.priority in priorityVal ? priorityVal[b.priority] : 1;
    if (pa !== pb) return pa - pb;
    return (a.order || 0) - (b.order || 0);
  });
  return active.concat(completed);
}

function renderTasks() {
  var list = document.getElementById('taskList');
  while (list.firstChild) list.removeChild(list.firstChild);

  if (!taskData || !Array.isArray(taskData)) { taskData = []; }
  // Widget only shows active tasks — completed tasks stay in the dashboard
  var activeTasks = taskData.filter(function(t) { return !t.done; });
  var sorted = sortTasks(activeTasks);

  if (sorted.length === 0) {
    list.appendChild(el('div', 'empty-state', 'No tasks yet'));
    updateCounter();
    return;
  }

  for (var j = 0; j < sorted.length; j++) {
    (function(task, index) {
      var item = el('div', 'task-item');
      item.setAttribute('data-id', task.id);

      // Priority dot
      var priColor = PRIORITY_COLORS[task.priority || 'medium'] || PRIORITY_COLORS.medium;
      var priDot = el('div', 'task-priority-dot');
      priDot.style.background = priColor;
      if (task.priority === 'high' && !task.done) {
        priDot.style.boxShadow = '0 0 6px ' + priColor;
      }
      priDot.draggable = false;
      priDot.addEventListener('mousedown', function(e) { e.stopPropagation(); });
      priDot.addEventListener('click', function(e) {
        e.stopPropagation();
        var next = task.priority === 'low' ? 'medium' : (task.priority === 'medium' ? 'high' : 'low');
        window.tasksAPI.setPriority(task.id, next);
      });
      priDot.title = (task.priority || 'medium') + ' priority (click to change)';

      var checkbox = el('button', 'task-checkbox' + (task.done ? ' done' : ''));
      checkbox.textContent = task.done ? '\u2713' : '';
      checkbox.draggable = false;
      checkbox.addEventListener('mousedown', function(e) { e.stopPropagation(); });
      checkbox.addEventListener('click', function(e) {
        e.stopPropagation();
        window.tasksAPI.toggleTask(task.id);
      });

      var textWrap = el('div');
      textWrap.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;';

      var text = el('span', 'task-text' + (task.done ? ' done' : ''), task.text);
      textWrap.appendChild(text);

      // Due date badge from linked calendar event
      if (task.dueDate) {
        var dueBadge = el('span');
        var dp = task.dueDate.split('-');
        var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        var dueText = months[parseInt(dp[1], 10) - 1] + ' ' + parseInt(dp[2], 10);
        if (task.dueTime) dueText += ' \u00B7 ' + task.dueTime;

        // Check if overdue
        var now = new Date();
        var dueMs = task.dueTime
          ? new Date(task.dueDate + 'T' + task.dueTime).getTime()
          : new Date(task.dueDate + 'T23:59').getTime();
        var isOverdue = !task.done && dueMs < now.getTime();
        var isToday = task.dueDate === (now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0'));

        dueBadge.style.cssText = 'font-size:9px;font-family:"Cascadia Code","JetBrains Mono",Consolas,monospace;display:inline-flex;align-items:center;gap:3px;';
        if (isOverdue) {
          dueBadge.style.color = '#f87171';
          dueBadge.style.fontWeight = '700';
          dueText = 'OVERDUE \u00B7 ' + dueText;
        } else if (isToday) {
          dueBadge.style.color = 'var(--accent)';
          dueBadge.style.fontWeight = '600';
          dueText = 'Today' + (task.dueTime ? ' \u00B7 ' + task.dueTime : '');
        } else {
          dueBadge.style.color = 'var(--text-dim)';
        }
        dueBadge.textContent = '\uD83D\uDCC5 ' + dueText;
        textWrap.appendChild(dueBadge);
      }

      var del = el('button', 'task-delete', '\u00D7');
      del.title = 'Delete';
      del.draggable = false;
      del.addEventListener('mousedown', function(e) { e.stopPropagation(); });
      del.addEventListener('click', function(e) {
        e.stopPropagation();
        window.tasksAPI.deleteTask(task.id);
      });

      // Schedule button (creates calendar event)
      var schedBtn = null;
      if (!task.done) {
        schedBtn = el('button', 'task-schedule', '\uD83D\uDCC5');
        schedBtn.title = 'Schedule as calendar event';
        schedBtn.draggable = false;
        schedBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:13px;padding:2px 4px;opacity:0.85;transition:opacity 0.15s;flex-shrink:0;filter:saturate(0.7) brightness(0.85);';
        schedBtn.addEventListener('mousedown', function(e) { e.stopPropagation(); });
        schedBtn.addEventListener('mouseenter', function() { schedBtn.style.opacity = '1'; });
        schedBtn.addEventListener('mouseleave', function() { schedBtn.style.opacity = '0.85'; });
        schedBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          var today = new Date();
          var dateStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
          window.tasksAPI.scheduleTask(task.id, dateStr, null).then(function(result) {
            if (result && result.alreadyExists) {
              schedBtn.textContent = '\u2714';
              schedBtn.style.opacity = '1';
              schedBtn.style.color = 'var(--text-dim)';
              setTimeout(function() { schedBtn.textContent = '\uD83D\uDCC5'; schedBtn.style.opacity = '0.85'; schedBtn.style.color = ''; }, 1500);
            } else if (result && result.success) {
              schedBtn.textContent = '\u2713';
              schedBtn.style.opacity = '1';
              schedBtn.style.color = 'var(--green)';
              setTimeout(function() { schedBtn.textContent = '\uD83D\uDCC5'; schedBtn.style.opacity = '0.85'; schedBtn.style.color = ''; }, 2000);
            }
          });
        });
      }

      // Drag to reorder
      if (!task.done) {
        item.draggable = true;
        item.addEventListener('dragstart', function(e) {
          draggedTaskId = task.id;
          item.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
        });
        item.addEventListener('dragend', function() {
          item.classList.remove('dragging');
          draggedTaskId = null;
          // Collect new order
          var items = document.querySelectorAll('.task-item[data-id]');
          var ids = [];
          for (var k = 0; k < items.length; k++) {
            var tid = items[k].getAttribute('data-id');
            if (tid) ids.push(tid);
          }
          window.tasksAPI.reorder(ids);
        });
        item.addEventListener('dragover', function(e) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          var rect = item.getBoundingClientRect();
          var midY = rect.y + rect.height / 2;
          if (e.clientY < midY) {
            item.classList.add('drag-above');
            item.classList.remove('drag-below');
          } else {
            item.classList.add('drag-below');
            item.classList.remove('drag-above');
          }
        });
        item.addEventListener('dragleave', function() {
          item.classList.remove('drag-above', 'drag-below');
        });
        item.addEventListener('drop', function(e) {
          e.preventDefault();
          item.classList.remove('drag-above', 'drag-below');
          if (!draggedTaskId || draggedTaskId === task.id) return;
          // Move dragged item before/after this one
          var rect = item.getBoundingClientRect();
          var before = e.clientY < rect.y + rect.height / 2;
          var dragEl = document.querySelector('[data-id="' + draggedTaskId + '"]');
          if (dragEl) {
            if (before) {
              item.parentNode.insertBefore(dragEl, item);
            } else {
              item.parentNode.insertBefore(dragEl, item.nextSibling);
            }
          }
        });
      }

      item.appendChild(priDot);
      item.appendChild(checkbox);
      item.appendChild(textWrap);
      // Note button — opens task-specific note
      var noteBtn = el('button', 'task-schedule', '\uD83D\uDCDD');
      noteBtn.title = 'Open note for this task';
      noteBtn.draggable = false;
      noteBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:11px;padding:2px 4px;opacity:0.5;transition:opacity 0.15s;flex-shrink:0;';
      noteBtn.addEventListener('mousedown', function(e) { e.stopPropagation(); });
      noteBtn.addEventListener('mouseenter', function() { noteBtn.style.opacity = '1'; });
      noteBtn.addEventListener('mouseleave', function() { noteBtn.style.opacity = '0.5'; });
      noteBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        window.tasksAPI.openTaskNote(task.id, task.text);
      });

      if (schedBtn) item.appendChild(schedBtn);
      item.appendChild(noteBtn);
      item.appendChild(del);
      list.appendChild(item);
    })(sorted[j], j);
  }

  updateCounter();
}

document.getElementById('addInput').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') {
    var text = this.value.trim();
    if (!text) return;
    var input = this;
    input.disabled = true;

    window.tasksAPI.smartAdd(text).then(function(result) {
      input.disabled = false;
      input.value = '';
      if (result && result.event) {
        // Show brief feedback that a calendar event was also created
        input.placeholder = '\u2713 Task + calendar event created!';
        input.style.borderColor = '#4ade80';
        setTimeout(function() {
          input.placeholder = '+ Add task...';
          input.style.borderColor = '';
        }, 2000);
      }
    }).catch(function() {
      // Fallback to regular add
      window.tasksAPI.addTask(text);
      input.disabled = false;
      input.value = '';
    });
  }
});

document.getElementById('minimizeBtn').addEventListener('click', function() {
  window.tasksAPI.close();
});
document.getElementById('closeBtn').addEventListener('click', function() {
  window.tasksAPI.close();
});

window.tasksAPI.onTasksUpdate(function(data) {
  taskData = data;
  renderTasks();
});

window.tasksAPI.getTasks().then(function(data) {
  taskData = data;
  renderTasks();
});

window.tasksAPI.onThemeUpdate(function(t) {
  var r = document.documentElement;
  r.style.setProperty('--bg', t.bg);
  r.style.setProperty('--surface', t.surface);
  r.style.setProperty('--surface2', t.surface2);
  r.style.setProperty('--border', t.border);
  r.style.setProperty('--text', t.text);
  r.style.setProperty('--text-dim', t.textDim);
  r.style.setProperty('--accent', t.accent);
  if (t.green) r.style.setProperty('--green', t.green);
  if (t.red) r.style.setProperty('--red', t.red);
});

window.tasksAPI.onSnapGlow(function() {
  var body = document.body;
  body.classList.remove('snap-glow');
  void body.offsetWidth;
  body.classList.add('snap-glow');
});
