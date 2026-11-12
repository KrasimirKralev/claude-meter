// Runs before first paint so the theme never flashes. The desktop app names its theme in the URL.
try {
  const fromApp = new URLSearchParams(location.search).get('theme');
  if (['brutal', 'dark', 'light'].includes(fromApp)) {
    document.documentElement.dataset.theme = fromApp;
    document.documentElement.dataset.skin = 'app';
  } else if (localStorage.getItem('balonche-theme') === 'light') {
    document.documentElement.dataset.theme = 'light';
  }
} catch {
  // Storage blocked: stay on the default dark theme.
}
