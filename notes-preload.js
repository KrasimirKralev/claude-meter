const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notesAPI', {
  // Legacy single-note (for migration)
  getNotes: () => ipcRenderer.invoke('notes-get'),
  saveNotes: (text) => ipcRenderer.send('notes-save', text),
  // Multi-note sticky notes
  getStickyNotes: () => ipcRenderer.invoke('sticky-notes-get'),
  saveStickyNotes: (notes) => ipcRenderer.send('sticky-notes-save', notes),
  // Export / share
  exportMd: (note) => ipcRenderer.invoke('notes-export-md', note),
  exportPdf: (payload) => ipcRenderer.invoke('notes-export-pdf', payload),
  copyText: (text) => ipcRenderer.send('notes-copy', text),
  // Archive (deleted notes history)
  getArchive: () => ipcRenderer.invoke('notes-archive-get'),
  archiveNote: (note) => ipcRenderer.send('notes-archive-add', note),
  restoreFromArchive: (noteId) => ipcRenderer.send('notes-archive-restore', noteId),
  // Task-specific notes
  getTaskNote: (taskId) => ipcRenderer.invoke('task-note-get', taskId),
  saveTaskNote: (taskId, text) => ipcRenderer.send('task-note-save', taskId, text),
  close: () => ipcRenderer.send('notes-window-close'),
  onSnapGlow: (cb) => ipcRenderer.on('snap-glow', () => cb()),
  onLoadTaskNote: (cb) => ipcRenderer.on('load-task-note', (_e, data) => cb(data)),
  onLoadGlobalNote: (cb) => ipcRenderer.on('load-global-note', () => cb()),
  onThemeUpdate: (cb) => ipcRenderer.on('theme-update', (_e, data) => cb(data)),
});
