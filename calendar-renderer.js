/* The Calendar panel beside the widget: its window, around the shared calendar. */
var calendarPanel = PlanCalendar.mount(document.getElementById('calendarRoot'), window.calendarAPI);

document.getElementById('closeBtn').addEventListener('click', function() { window.calendarAPI.close(); });
window.calendarAPI.onCalendarUpdate(calendarPanel.update);
window.calendarAPI.getEvents().then(calendarPanel.update);
window.calendarAPI.onThemeUpdate(UI.applyTheme);
window.calendarAPI.onSnapGlow(function() {
  document.body.classList.remove('snap-glow');
  void document.body.offsetWidth;
  document.body.classList.add('snap-glow');
});
