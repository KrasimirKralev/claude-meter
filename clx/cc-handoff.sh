#!/usr/bin/env bash
# UserPromptSubmit / Stop / PostToolUse hook: mid-session account hand-off.
#
# `clx` launches an interactive REPL with CLAUDE_CONFIG_DIR=~/.clx-sessions/<pid>,
# a dir whose .credentials.json is a SYMLINK into one account dir. Claude Code
# re-reads that file on every request, so when the account this session runs on
# is at or over clx's 5-hour threshold and another account still has head-room,
# `clx --handoff-check` re-points the symlink and the RUNNING process continues
# on the next account - no restart, no --continue, subagents and background tasks
# untouched. On the next prompt it prints one line saying the session moved.
# Outside a session dir (plain `claude`, or `clx` with CLX_NO_SESSION=1) there is
# nothing to re-point, so it prints the old "/exit then clx -c" nudge instead.
# Under the threshold it prints nothing at all.
#
# It must stay fast (<100 ms) and it runs on EVERY tool call, so:
#   * the payload is read with bash builtins, no forks;
#   * post-tool events are throttled to one real check per POST_TOOL_EVERY
#     seconds, so the common case costs a builtin read and a string match;
#   * `clx --handoff-check` never blocks on the network - it reads
#     ~/.claude/cc-usage-cache.json and forks a detached refresh when stale.
#
# It always exits 0: a non-zero UserPromptSubmit hook blocks the prompt and a
# non-zero Stop hook blocks the turn from ending, and a usage nudge must never
# cost the user their turn.

CLX="${CLX_BIN:-$HOME/.local/bin/clx}"
POST_TOOL_EVERY=20

# The throttle stamp is PER SESSION. One global stamp meant a busy session -
# one running a command every few seconds - suppressed the PostToolUse checks of
# every OTHER session on the machine, and a session that is never checked is
# never handed off (finding-blocked-session.md, 2026-09-05). Inside a clx session
# dir the stamp lives in it; outside one the config dir path itself is the key,
# with its slashes folded into a single filename. Parameter expansion only, so a
# throttled event still costs no fork at all.
cfg="${CLAUDE_CONFIG_DIR:-}"
case "$cfg" in
  "$HOME"/.clx-sessions/*)
    STAMP="$cfg/.post-tool.stamp" ;;
  *)
    key="${cfg:-$HOME/.claude}"
    key="${key//\//_}"
    if [ ${#key} -gt 120 ]; then key="${key:${#key}-120}"; fi
    STAMP="$HOME/.claude/.cc-handoff-post-tool.$key.stamp" ;;
esac

# Read the payload with a builtin. The cap matters: a PostToolUse payload embeds
# the whole tool result, and every field we need (hook_event_name, session_id,
# transcript_path, cwd) precedes it. clx re-parses the same text and falls back
# to a regex when this cap truncates the JSON.
payload=""
IFS= read -r -d '' -N 262144 payload 2>/dev/null
cat >/dev/null 2>&1 || true   # drain the rest so the writer never blocks

case "$payload" in
  *'"hook_event_name":"Stop"'*|*'"hook_event_name": "Stop"'*)             event=stop ;;
  *'"hook_event_name":"PostToolUse"'*|*'"hook_event_name": "PostToolUse"'*) event=post-tool ;;
  *'"hook_event_name":"UserPromptSubmit"'*|*'"hook_event_name": "UserPromptSubmit"'*) event=prompt ;;
  *) event=prompt ;;
esac

# Throttle the per-tool-call path. $EPOCHSECONDS and `read` are builtins, so a
# throttled PostToolUse costs no fork at all.
if [ "$event" = post-tool ]; then
  now=${EPOCHSECONDS:-0}
  last=0
  { read -r last < "$STAMP"; } 2>/dev/null || true
  case "$last" in ''|*[!0-9]*) last=0 ;; esac
  if [ "$now" != 0 ] && [ $((now - last)) -lt "$POST_TOOL_EVERY" ]; then
    exit 0
  fi
  printf '%s\n' "$now" > "$STAMP.$$" 2>/dev/null && mv -f "$STAMP.$$" "$STAMP" 2>/dev/null || true
fi

printf '%s' "$payload" | "$CLX" --handoff-check --event "$event" 2>/dev/null || true
exit 0
