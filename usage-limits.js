// Usage limits: turns the body of /api/oauth/usage into the widget's meters the
// way Claude Code itself reads it (checked against 2.1.317). Plain Node so the
// rules can be tested without Electron (test/usage-limits.test.js).
//
// The server's `limits[]` rows are the source of truth: `kind` says which meter
// a row is ('session', 'weekly_all', 'weekly_scoped'), `severity` is the
// server's own grade for its colour ('normal', 'warning', 'critical') and
// `is_active` marks the row a single-value indicator should show - it moves to
// whichever limit is binding (a scoped Fable cap at 100 % takes it from the
// weekly row). The legacy fields (`five_hour`, `seven_day`,
// `seven_day_sonnet`) only fill a meter that has no row.
//
// A plan without a meter reports it as null - the Ultra plan has no 5-hour
// session limit, so `five_hour` is null and no 'session' row exists. That
// meter is then null here too, never { pct: 0 }: Claude Code hides such a row,
// and so must every consumer of this object.

// The three meters the widget keeps history, alerts and settings for. The
// internal key `weekSonnet` predates model-named caps; it now holds whichever
// model-scoped weekly cap the server reports (Fable today).
const METER_KEYS = ['session', 'weekAll', 'weekSonnet'];
const SHORT_LABELS = { session: '5h', weekAll: '7d' };

function clampPct(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function scopeName(scope, part) {
  const named = scope && scope[part];
  const name = named && typeof named.display_name === 'string' ? named.display_name.trim() : '';
  return name || null;
}

// Claude Code's own row titles, so the widget reads the same as /usage.
function limitLabel(kind, model, surface) {
  if (kind === 'session') return 'Current session';
  if (kind === 'weekly_all') return 'Current week (all models)';
  const scoped = model || surface;
  if (kind === 'weekly_scoped' && scoped) return 'Current week (' + scoped + ')';
  if (scoped) return scoped;
  return String(kind || 'Limit').replace(/_/g, ' ');
}

function rowFromLimit(limit) {
  if (!limit || typeof limit !== 'object' || typeof limit.kind !== 'string') return null;
  const pct = clampPct(limit.percent);
  if (pct === null) return null;
  const model = scopeName(limit.scope, 'model');
  const surface = scopeName(limit.scope, 'surface');
  const row = {
    kind: limit.kind,
    group: typeof limit.group === 'string' ? limit.group : null,
    pct,
    resetsAt: typeof limit.resets_at === 'string' ? limit.resets_at : null,
    label: limitLabel(limit.kind, model, surface),
    severity: typeof limit.severity === 'string' ? limit.severity : null,
    active: limit.is_active === true,
  };
  if (model) row.model = model;
  if (surface) row.surface = surface;
  return row;
}

function legacyMeter(window, label, extra) {
  if (!window || typeof window !== 'object') return null;
  const pct = clampPct(window.utilization);
  if (pct === null) return null;
  return Object.assign({
    pct,
    resetsAt: typeof window.resets_at === 'string' ? window.resets_at : null,
    label,
    severity: null,
    active: false,
  }, extra || {});
}

function meterFromRow(row) {
  const meter = {
    pct: row.pct,
    resetsAt: row.resetsAt,
    label: row.label,
    severity: row.severity,
    active: row.active,
  };
  if (row.model) meter.model = row.model;
  return meter;
}

function buildExtraUsage(data) {
  const eu = data.extra_usage;
  if (!eu || typeof eu !== 'object') return { enabled: false };
  const util = Number(eu.utilization);
  const dec = Number.isFinite(Number(eu.decimal_places)) ? Number(eu.decimal_places) : 2;
  const num = (v) => (v !== null && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : null);
  const extra = {
    enabled: !!eu.is_enabled,
    utilization: eu.utilization !== null && Number.isFinite(util) ? util : null,
    usedMinor: num(eu.used_credits),
    limitMinor: num(eu.monthly_limit),
    currency: typeof eu.currency === 'string' ? eu.currency : 'USD',
    decimals: dec,
  };
  // Prefer the precise percent/severity from the spend object when present
  if (data.spend && typeof data.spend.percent === 'number') {
    extra.percent = data.spend.percent;
    extra.severity = data.spend.severity || null;
  }
  return extra;
}

// The usage object every part of the app reads. `now` is the sync time.
function buildUsage(data, now) {
  const body = data && typeof data === 'object' ? data : {};
  const rows = Array.isArray(body.limits) ? body.limits.map(rowFromLimit).filter(Boolean) : [];

  const sessionRow = rows.find((r) => r.kind === 'session');
  const weekAllRow = rows.find((r) => r.kind === 'weekly_all');
  const scopedRow = rows.find((r) => r.kind === 'weekly_scoped' && r.model);

  const usage = {
    session: sessionRow ? meterFromRow(sessionRow)
      : legacyMeter(body.five_hour, 'Current session'),
    weekAll: weekAllRow ? meterFromRow(weekAllRow)
      : legacyMeter(body.seven_day, 'Current week (all models)'),
    weekSonnet: scopedRow ? meterFromRow(scopedRow)
      : legacyMeter(body.seven_day_sonnet, 'Current week (Sonnet)', { model: 'Sonnet' }),
    // Rows the three meters do not cover (a second scoped model, a surface
    // cap, a kind this build does not know), in the server's order.
    otherLimits: rows.filter((r) => r !== sessionRow && r !== weekAllRow && r !== scopedRow),
    extraUsage: buildExtraUsage(body),
    syncTime: typeof now === 'number' ? now : Date.now(),
  };
  usage.headline = headlineKey(usage);
  return usage;
}

// The meter a single-value indicator (tab dot, tray line) shows: the server's
// is_active pick, else the fullest meter present.
function headlineKey(usage) {
  if (!usage) return null;
  const present = METER_KEYS.filter((k) => usage[k]);
  const active = present.find((k) => usage[k].active);
  if (active) return active;
  let best = null;
  for (const k of present) {
    if (best === null || usage[k].pct > usage[best].pct) best = k;
  }
  return best;
}

// Bar grade for a meter: the server's severity when it sent one, else the
// widget's own pct thresholds (60 / 85, as the meters always used).
function gradeOf(meter) {
  if (!meter) return null;
  if (meter.severity === 'critical') return 'danger';
  if (meter.severity === 'warning') return 'warning';
  if (meter.severity === 'normal') return 'normal';
  if (meter.pct >= 85) return 'danger';
  if (meter.pct >= 60) return 'warning';
  return 'normal';
}

// A short name for a meter in one-line summaries ("7d 24% · Fable 2%").
function shortLabel(key, meter) {
  if (key === 'weekSonnet') return (meter && meter.model) || 'Model';
  return SHORT_LABELS[key] || key;
}

// "7d 24% · Fable 100%" - only the meters this plan has.
function summaryLine(usage) {
  if (!usage) return '';
  return METER_KEYS.filter((k) => usage[k])
    .map((k) => shortLabel(k, usage[k]) + ' ' + usage[k].pct + '%')
    .join(' · ');
}

// True when every present meter reads 0 and none carries a reset time - the
// shape of a bad response, not of a fresh week.
function looksEmpty(usage) {
  const present = METER_KEYS.filter((k) => usage && usage[k]);
  return present.every((k) => usage[k].pct === 0 && !usage[k].resetsAt);
}

function anyUsage(usage) {
  return METER_KEYS.some((k) => usage && usage[k] && usage[k].pct > 0);
}

// Usage objects cached by builds before 2.15 always carried all three meters,
// with { pct: 0, resetsAt: null } standing in for "this plan has none". Read
// such a placeholder as absent so an old cache never paints a fake 0 % bar.
function normalizeCached(usage) {
  if (!usage || typeof usage !== 'object') return usage;
  const out = Object.assign({}, usage);
  for (const k of METER_KEYS) {
    const m = out[k];
    if (!m || typeof m !== 'object' || typeof m.pct !== 'number') {
      out[k] = null;
    } else if (m.pct === 0 && !m.resetsAt && !('severity' in m)) {
      out[k] = null;
    }
  }
  if (!Array.isArray(out.otherLimits)) out.otherLimits = [];
  if (!out.headline || !out[out.headline]) out.headline = headlineKey(out);
  return out;
}

module.exports = {
  METER_KEYS,
  clampPct,
  limitLabel,
  rowFromLimit,
  buildUsage,
  headlineKey,
  gradeOf,
  shortLabel,
  summaryLine,
  looksEmpty,
  anyUsage,
  normalizeCached,
};
