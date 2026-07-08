const { contextBridge, ipcRenderer } = require('electron');

let tasksHandler = null;

contextBridge.exposeInMainWorld('tasksAPI', {
  getTasks: () => ipcRenderer.invoke('tasks-get'),
  addTask: (text) => ipcRenderer.send('tasks-add', text),
  smartAdd: (text) => ipcRenderer.invoke('smart-add', text),
  toggleTask: (id) => ipcRenderer.send('tasks-toggle', id),
  deleteTask: (id) => ipcRenderer.send('tasks-delete', id),
  setPriority: (id, priority) => ipcRenderer.send('tasks-set-priority', id, priority),
  reorder: (orderedIds) => ipcRenderer.send('tasks-reorder', orderedIds),
  scheduleTask: (id, date, time) => ipcRenderer.invoke('tasks-schedule', id, date, time),
  openTaskNote: (id, text) => ipcRenderer.send('open-task-note', id, text),
  clearCompleted: () => ipcRenderer.send('tasks-clear-completed'),
  close: () => ipcRenderer.send('tasks-window-close'),
  onSnapGlow: (cb) => ipcRenderer.on('snap-glow', () => cb()),
  onThemeUpdate: (cb) => ipcRenderer.on('theme-update', (_e, data) => cb(data)),
  onTasksUpdate: (cb) => {
    if (tasksHandler) ipcRenderer.removeListener('tasks-update', tasksHandler);
    tasksHandler = (_e, data) => cb(data);
    ipcRenderer.on('tasks-update', tasksHandler);
  },
});
