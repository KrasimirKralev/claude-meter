#!/usr/bin/env bash
# install.sh and clx on a fresh machine: one login in ~/.claude, no cc.json, no
# ~/.claude-* dirs, a stub `claude`, and every HTTPS request sent to a closed port,
# so the fake tokens never leave the box. Nothing outside a throw-away HOME is touched.
# Usage: bash clx/test/test-install.sh [dir holding install.sh, clx, ...]
set -u
SRC="$(cd "${1:-$(dirname "${BASH_SOURCE[0]}")/..}" && pwd)"
T="$(mktemp -d "${TMPDIR:-/tmp}/clx-stranger-XXXX")"
export HOME="$T/home" CLX_NO_NOTIFY=1 CLX_NO_WATCH=1
export HTTPS_PROXY=http://127.0.0.1:9 https_proxy=http://127.0.0.1:9 NO_PROXY= no_proxy=
unset CLAUDE_CONFIG_DIR CLX_INSIDE CLAUDECODE
mkdir -p "$HOME/.claude" "$T/bin"
export PATH="$T/bin:$HOME/.local/bin:/usr/bin:/bin"
cat >"$T/bin/claude" <<'EOF'
#!/usr/bin/env bash
echo "STUB-CLAUDE dir=${CLAUDE_CONFIG_DIR:-<none>} args=$*"
EOF
chmod 755 "$T/bin/claude"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ok   $*"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL $*"; }
chk() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }

creds() {  # $1 dir
  local exp=$(( ($(date +%s) + 7200) * 1000 ))
  printf '{"claudeAiOauth":{"accessToken":"sk-ant-oat01-FAKE-%s","refreshToken":"sk-ant-ort01-FAKE","expiresAt":%s,"scopes":["user:inference","user:profile"],"subscriptionType":"max"}}' "$RANDOM" "$exp" >"$1/.credentials.json"
  chmod 600 "$1/.credentials.json"
}
creds "$HOME/.claude"
printf '{"oauthAccount":{"emailAddress":"alice@example.com"},"theme":"dark"}' >"$HOME/.claude.json"
# A user who already has settings and an unrelated hook: both must survive.
cat >"$HOME/.claude/settings.json" <<'EOF'
{"model":"opus","hooks":{"Stop":[{"hooks":[{"type":"command","command":"/usr/bin/true"}]}]}}
EOF

echo "== install"
bash "$SRC/install.sh" >"$T/install.out" 2>&1; rc=$?
chk "install exits 0 (rc=$rc)" '[ $rc = 0 ]'
for f in clx clx-move cm-login; do chk "$f installed and executable" "[ -x '$HOME/.local/bin/$f' ]"; done
chk "hook installed" "[ -x '$HOME/.claude/hooks/cc-handoff.sh' ]"
hooks() { python3 -c "
import json,sys;s=json.load(open('$HOME/.claude/settings.json'))
print(sum(1 for ev in ('UserPromptSubmit','Stop','PostToolUse') for g in s.get('hooks',{}).get(ev,[]) for h in g['hooks'] if h['command'].endswith('cc-handoff.sh')), s.get('model'), sum(1 for g in s.get('hooks',{}).get('Stop',[]) for h in g['hooks'] if h['command']=='/usr/bin/true'))"; }
chk "3 hook entries, model kept, other Stop hook kept" "[ \"\$(hooks)\" = '3 opus 1' ]"
bash "$SRC/install.sh" >/dev/null 2>&1
chk "second install is idempotent" "[ \"\$(hooks)\" = '3 opus 1' ]"

echo "== clx --status with one login, no cc.json"
"$HOME/.local/bin/clx" --status >"$T/status1.out" 2>&1; rc=$?
chk "status exits 0 (rc=$rc)" '[ $rc = 0 ]'
chk "status names the account" "grep -qi alice '$T/status1.out'"
chk "no 'primary : not logged in' note" "! grep -q 'primary .*not logged in' '$T/status1.out'"
chk "no traceback" "! grep -q Traceback '$T/status1.out'"

echo "== launch"
"$HOME/.local/bin/clx" -p hello >"$T/launch1.out" 2>&1; rc=$?
chk "clx -p reaches claude (rc=$rc)" "grep -q 'STUB-CLAUDE.*args=-p hello' '$T/launch1.out'"
chk "no traceback" "! grep -q Traceback '$T/launch1.out'"
script -qec "$HOME/.local/bin/clx" /dev/null </dev/null >"$T/launch2.out" 2>&1; rc=$?
chk "interactive clx reaches claude in a session dir" "grep -q 'STUB-CLAUDE dir=$HOME/.clx-sessions/' '$T/launch2.out'"
chk "no traceback" "! grep -q Traceback '$T/launch2.out'"

echo "== hook"
printf '{"hook_event_name":"UserPromptSubmit","session_id":"x"}' | "$HOME/.claude/hooks/cc-handoff.sh"; rc=$?
chk "hook exits 0 outside a session (rc=$rc)" '[ $rc = 0 ]'

echo "== second account"
mkdir -p -m 700 "$HOME/.claude-work"; creds "$HOME/.claude-work"
printf '{"oauthAccount":{"emailAddress":"bob@example.com"}}' >"$HOME/.claude-work/.claude.json"
"$HOME/.local/bin/clx" --init >"$T/init.out" 2>&1; rc=$?
chk "clx --init exits 0 (rc=$rc)" '[ $rc = 0 ]'
chk "settings.json linked into the account dir" "[ -L '$HOME/.claude-work/settings.json' ]"
chk "prefs copied, identity kept" "python3 -c \"import json;d=json.load(open('$HOME/.claude-work/.claude.json'));assert d['theme']=='dark' and d['oauthAccount']['emailAddress']=='bob@example.com'\""
"$HOME/.local/bin/clx" --status >"$T/status2.out" 2>&1; rc=$?
chk "status lists both accounts (rc=$rc)" "grep -qi alice '$T/status2.out' && grep -qi work '$T/status2.out'"
"$HOME/.local/bin/clx-move" --dry-run work >"$T/move.out" 2>&1; rc=$?
chk "clx-move answers JSON (rc=$rc)" "python3 -c \"import json;json.loads(open('$T/move.out').read().strip().splitlines()[-1])\""
"$HOME/.local/bin/cm-login" status >"$T/cm.out" 2>&1; rc=$?
chk "cm-login status lists work (rc=$rc)" "grep -q '^work ' '$T/cm.out'"
"$HOME/.local/bin/cm-login" 'Bad Name' >/dev/null 2>&1; rc=$?
chk "cm-login refuses a bad name" '[ $rc = 1 ]'

echo "== uninstall"
bash "$SRC/install.sh" --uninstall >"$T/uninstall.out" 2>&1; rc=$?
chk "uninstall exits 0 (rc=$rc)" '[ $rc = 0 ]'
chk "programs gone" "[ ! -e '$HOME/.local/bin/clx' ] && [ ! -e '$HOME/.local/bin/clx-move' ] && [ ! -e '$HOME/.local/bin/cm-login' ]"
chk "hook entries gone, the rest kept" "[ \"\$(hooks)\" = '0 opus 1' ]"
chk "logins untouched" "[ -f '$HOME/.claude-work/.credentials.json' ] && [ -f '$HOME/.claude/.credentials.json' ]"

echo "install: $PASS passed, $FAIL failed  (sandbox $T)"
[ $FAIL = 0 ] || { echo "--- status1"; cat "$T/status1.out"; echo "--- launch2"; cat "$T/launch2.out"; echo "--- install"; cat "$T/install.out"; }
[ $FAIL = 0 ]
