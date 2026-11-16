#!/usr/bin/env bash
# Install clx: the multi-account launcher for Claude Code (Linux).
#
#   ./install.sh              install or update clx, clx-move, cm-login and the hand-off hook
#   ./install.sh --alias      also make a plain `claude` go through clx (adds a block to ~/.bashrc)
#   ./install.sh --uninstall  remove all of it again (account dirs and logins are left alone)
#
# What it touches, and nothing else:
#   ~/.local/bin/{clx,clx-move,cm-login}   the programs (Claude Meter looks for clx-move here)
#   ~/.claude/hooks/cc-handoff.sh          the hook that moves a running session
#   ~/.claude/settings.json                three hook entries (backed up first)
#   ~/.bashrc                              only with --alias, between marker lines
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="$HOME/.local/bin"
HOOK="$HOME/.claude/hooks/cc-handoff.sh"
SETTINGS="$HOME/.claude/settings.json"
BASHRC="$HOME/.bashrc"
MARK_BEGIN="# >>> clx claude alias >>>"
MARK_END="# <<< clx claude alias <<<"
STAMP="$(date +%Y%m%d-%H%M%S)"

say() { printf '%s\n' "$*"; }
die() { printf 'install.sh: %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = Linux ] || die "clx runs on Linux only (it relies on /proc and on Claude Code keeping its login in a file)."
command -v python3 >/dev/null || die "python3 is required."

# settings.json edits go through Python's json module, never sed: the file is the
# user's whole Claude Code configuration and must stay valid JSON.
edit_settings() {   # $1 = add | remove
  python3 - "$1" "$SETTINGS" "$HOOK" <<'PY'
import json, os, shlex, sys
mode, path, hook = sys.argv[1], sys.argv[2], sys.argv[3]
events = ("UserPromptSubmit", "Stop", "PostToolUse")
# Claude Code runs the command through a shell, so a HOME with a space in it
# must be quoted. Either spelling counts as ours when checking or removing.
command = shlex.quote(hook)
ours = {hook, command}
real = os.path.realpath(path)
try:
    with open(real) as fh:
        data = json.load(fh)
except FileNotFoundError:
    data = {}
hooks = data.setdefault("hooks", {})
changed = False
for ev in events:
    groups = hooks.get(ev) or []
    has = any(h.get("command") in ours for g in groups for h in g.get("hooks", []))
    if mode == "add" and not has:
        groups.append({"hooks": [{"type": "command", "command": command, "timeout": 5}]})
        changed = True
    elif mode == "remove" and has:
        for g in groups:
            g["hooks"] = [h for h in g.get("hooks", []) if h.get("command") not in ours]
        groups = [g for g in groups if g.get("hooks")]
        changed = True
    if groups:
        hooks[ev] = groups
    else:
        hooks.pop(ev, None)
if not hooks:
    data.pop("hooks", None)
if changed:
    tmp = real + ".clx-tmp"
    with open(tmp, "w") as fh:
        json.dump(data, fh, indent=2)
        fh.write("\n")
    os.chmod(tmp, 0o600)
    os.replace(tmp, real)
print("changed" if changed else "unchanged")
PY
}

backup_settings() {
  if [ -f "$SETTINGS" ]; then
    cp -p "$SETTINGS" "$SETTINGS.bak-clx-$STAMP"
    say "   backup: $SETTINGS.bak-clx-$STAMP"
  fi
}

remove_alias() {
  [ -f "$BASHRC" ] && grep -qF "$MARK_BEGIN" "$BASHRC" || return 0
  cp -p "$BASHRC" "$BASHRC.bak-clx-$STAMP"
  python3 - "$BASHRC" "$MARK_BEGIN" "$MARK_END" <<'PY'
import sys
path, begin, end = sys.argv[1:4]
out, skip = [], False
for line in open(path):
    if line.rstrip("\n") == begin:
        skip = True
    if not skip:
        out.append(line)
    if line.rstrip("\n") == end:
        skip = False
open(path, "w").write("".join(out))
PY
  say "   removed the claude alias from $BASHRC (backup: $BASHRC.bak-clx-$STAMP)"
}

if [ "${1:-}" = --uninstall ]; then
  say ">> Removing clx"
  for f in clx clx-move cm-login; do rm -f "$BIN/$f"; done
  if [ -f "$SETTINGS" ]; then
    backup_settings
    r=$(edit_settings remove) || die "could not edit $SETTINGS (is it valid JSON?)"
    say "   settings.json hooks: $r"
  fi
  rm -f "$HOOK"
  remove_alias
  say ">> Done. Your ~/.claude-* account dirs and their logins are untouched."
  say "   Running sessions keep their ~/.clx-sessions/<pid> dir until they exit."
  exit 0
fi

command -v claude >/dev/null || say "!! claude is not on PATH yet - install Claude Code before you run clx."

say ">> Installing clx into $BIN"
mkdir -p "$BIN" "$(dirname "$HOOK")"
for f in clx clx-move cm-login; do
  if [ -f "$BIN/$f" ] && ! cmp -s "$HERE/$f" "$BIN/$f"; then
    cp -p "$BIN/$f" "$BIN/$f.bak-$STAMP"
    say "   kept the old $f as $BIN/$f.bak-$STAMP"
  fi
  # Copy then rename: a running hook must never execute a half-written file.
  install -m 755 "$HERE/$f" "$BIN/.$f.new" || die "could not copy $f into $BIN"
  mv -f "$BIN/.$f.new" "$BIN/$f" || die "could not replace $BIN/$f"
done
install -m 755 "$HERE/cc-handoff.sh" "$(dirname "$HOOK")/.cc-handoff.sh.new" || die "could not copy the hook"
mv -f "$(dirname "$HOOK")/.cc-handoff.sh.new" "$HOOK" || die "could not replace $HOOK"

say ">> Registering the hand-off hook in $SETTINGS"
backup_settings
r=$(edit_settings add) || die "could not edit $SETTINGS (is it valid JSON?) - nothing else was changed there"
say "   UserPromptSubmit, Stop, PostToolUse: $r"

if [ "${1:-}" = --alias ]; then
  remove_alias
  # A file that does not end in a newline would glue the marker onto its last line.
  if [ -s "$BASHRC" ] && [ -n "$(tail -c 1 "$BASHRC")" ]; then printf '\n' >>"$BASHRC"; fi
  cat >>"$BASHRC" <<EOF
$MARK_BEGIN
# \`claude\` goes through clx, so an interactive session can move to another
# account without a restart. clx sets CLX_INSIDE in the session it starts, so a
# nested \`claude\` runs the real binary on the account already in use.
claude() {
  if [ -n "\${CLX_INSIDE:-}" ] || [ ! -x "\$HOME/.local/bin/clx" ]; then command claude "\$@"; else "\$HOME/.local/bin/clx" "\$@"; fi
}
$MARK_END
EOF
  say "   added the claude alias to $BASHRC (open a new terminal to use it)"
fi

say ">> Linking the shared profile into your ~/.claude-* account dirs"
"$BIN/clx" --init || true

case ":$PATH:" in *":$BIN:"*) ;; *) say "!! $BIN is not on your PATH - add it, or run $BIN/clx" ;; esac
say ""
say "Done. Next:"
say "  cm-login work you@example.com    log a second account into ~/.claude-work"
say "  clx --status                     see every account and which one clx would pick"
say "  clx                              start Claude Code on the account with the most room"
