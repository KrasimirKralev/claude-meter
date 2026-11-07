// Display-scale guard, the pure part (main.js wires it to Electron).
//
// Chromium follows GNOME's XSETTINGS scale live, but a window created before a
// change keeps its pixel size. At boot GNOME shows the laptop panel (2x) for a
// few seconds before the lid-closed layout with the 1x monitors applies, so the
// autostarted widget came up with every window twice its size (2026-10-26).
// The only cure is a relaunch once the scale now differs from the scale at start.

const RELAUNCH_ARG = '--scale-relaunched=';

// The relaunched process learns when the previous one restarted from its own
// argv, so the ten-minute floor below survives the restart.
function lastRelaunchFromArgv(argv) {
  for (const a of argv || []) {
    if (typeof a === 'string' && a.startsWith(RELAUNCH_ARG)) {
      const t = parseInt(a.slice(RELAUNCH_ARG.length), 10);
      if (Number.isFinite(t) && t > 0) return t;
    }
  }
  return 0;
}

// One decision, so it can be tested without Electron. `startScale` is what
// Chromium believed when its windows were created; `nowScale` what it believes
// now (null = unknown, never a reason to restart).
function shouldRelaunch({ startScale, nowScale, breakRunning, lastRelaunchAt, now }) {
  if (nowScale == null || startScale == null) return false;
  if (Math.abs(nowScale - startScale) < 0.01) return false;
  if (breakRunning) return false;
  // A display that keeps changing its mind must not bounce the app every
  // minute (every edit would be lost): at most one restart per ten minutes,
  // counted across the restart itself.
  if (lastRelaunchAt && now - lastRelaunchAt < 10 * 60 * 1000) return false;
  return true;
}

module.exports = { RELAUNCH_ARG, lastRelaunchFromArgv, shouldRelaunch };
