/* The Tasks panel beside the widget: its window, around the shared task list. */
var tasksPanel = PlanTasks.mount(document.getElementById('tasksRoot'), window.tasksAPI, {
  onCount: function(count) {
    document.getElementById('count').textContent = count > 0 ? PlanLib.countText(count, 'to do', 'to do') : '';
  },
});

document.getElementById('closeBtn').addEventListener('click', function() { window.tasksAPI.close(); });
window.tasksAPI.onTasksUpdate(tasksPanel.update);
window.tasksAPI.getTasks().then(tasksPanel.update);
window.tasksAPI.onThemeUpdate(UI.applyTheme);
window.tasksAPI.onSnapGlow(function() {
  document.body.classList.remove('snap-glow');
  void document.body.offsetWidth;
  document.body.classList.add('snap-glow');
});
