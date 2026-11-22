#!/usr/bin/env bash
# install.sh and clx on a fresh machine: one login in ~/.claude, no cc.json, no
# ~/.claude-* dirs, a stub `claude`, and every HTTPS request sent to a closed port,
# so the fake tokens never leave the box. Nothing outside a throw-away HOME is touched.
# Usage: bash test/test-install.sh [dir holding install.sh, clx, ...]
set -u
SRC="$(cd "${1:-$(dirname "${BASH_SOURCE[0]}")/..}" && pwd)"
T="$(mktemp -d "${TMPDIR:-/tmp}/clx-stranger-XXXX")"
# A space in HOME: the hook command registered in settings.json must be quoted.
export HOME="$T/my home" CLX_NO_NOTIFY=1 CLX_NO_WATCH=1
# clx-openclaw must never reach this machine's own systemd or processes from here.
mkdir -p "$T/proc"
export CLX_OPENCLAW_SYSTEMCTL="$T/no-systemctl" CLX_OPENCLAW_PROC="$T/proc"
unset XDG_DATA_HOME XDG_CONFIG_HOME OPENCLAW_STATE_DIR
export HTTPS_PROXY=http://127.0.0.1:9 https_proxy=http://127.0.0.1:9 NO_PROXY= no_proxy=
unset CLAUDE_CONFIG_DIR CLX_INSIDE CLAUDECODE
mkdir -p "$HOME/.claude" "$T/bin"
export PATH="$T/bin:$HOME/.local/bin:/usr/bin:/bin"
cat >"$T/bin/claude" <<'EOF'
#!/usr/bin/env bash
if [ "$*" = "auth status --json" ]; then echo '{"loggedIn": false, "authMethod": "none"}'; exit 1; fi
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
printf '{"oauthAccount":{"emailAddress":"alice@example.com"},"theme":"dark","projects":{"/srv/trusted":{"hasTrustDialogAccepted":true},"/srv/untrusted":{"hasTrustDialogAccepted":false},"/srv/unseen":{}}}' >"$HOME/.claude.json"
# A user who already has settings and an unrelated hook: both must survive.
printf 'export FOO=1' >"$HOME/.bashrc"
cat >"$HOME/.claude/settings.json" <<'EOF'
{"model":"opus","hooks":{"Stop":[{"hooks":[{"type":"command","command":"/usr/bin/true"}]}]}}
EOF

echo "== install"
bash "$SRC/install.sh" >"$T/install.out" 2>&1; rc=$?
chk "install exits 0 (rc=$rc)" '[ $rc = 0 ]'
for f in clx clx-move cm-login clx-openclaw; do chk "$f installed and executable" "[ -x '$HOME/.local/bin/$f' ]"; done
SKILL="$HOME/.local/share/clx/openclaw/skills/clx-accounts/SKILL.md"
chk "the OpenClaw skill is installed beside clx-openclaw" "cmp -s '$SRC/openclaw/skills/clx-accounts/SKILL.md' '$SKILL'"
chk "hook installed" "[ -x '$HOME/.claude/hooks/cc-handoff.sh' ]"
hooks() { python3 -c "
import json,sys;s=json.load(open('$HOME/.claude/settings.json'))
print(sum(1 for ev in ('UserPromptSubmit','Stop','PostToolUse') for g in s.get('hooks',{}).get(ev,[]) for h in g['hooks'] if 'cc-handoff.sh' in h['command']), s.get('model'), sum(1 for g in s.get('hooks',{}).get('Stop',[]) for h in g['hooks'] if h['command']=='/usr/bin/true'))"; }
chk "3 hook entries, model kept, other Stop hook kept" "[ \"\$(hooks)\" = '3 opus 1' ]"
bash "$SRC/install.sh" --alias >/dev/null 2>&1
chk "second install is idempotent" "[ \"\$(hooks)\" = '3 opus 1' ]"
chk "alias block starts on its own line" "grep -qx 'export FOO=1' '$HOME/.bashrc' && grep -qx '# >>> clx claude alias >>>' '$HOME/.bashrc'"
chk "the alias defines claude()" "bash -c 'source \"\$HOME/.bashrc\"; declare -F claude' >/dev/null"
hookcmd() { python3 -c "import json;print(json.load(open('$HOME/.claude/settings.json'))['hooks']['UserPromptSubmit'][-1]['hooks'][0]['command'])"; }
printf '{"hook_event_name":"UserPromptSubmit"}' | sh -c "$(hookcmd)"; rc=$?
chk "registered hook command runs under a HOME with a space (rc=$rc)" '[ $rc = 0 ]'

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
script -qec "'$HOME/.local/bin/clx'" /dev/null </dev/null >"$T/launch2.out" 2>&1; rc=$?
chk "interactive clx reaches claude in a session dir" "grep -q 'STUB-CLAUDE dir=$HOME/.clx-sessions/' '$T/launch2.out'"
sess="$(ls -d "$HOME"/.clx-sessions/[0-9]* 2>/dev/null | head -1)"
chk "missing shared dirs are created and linked (projects, plans)" "[ -d '$HOME/.claude/projects' ] && [ -d '$HOME/.claude/plans' ] && [ -L '$sess/projects' ] && [ -L '$sess/plans' ]"
chk "no traceback" "! grep -q Traceback '$T/launch2.out'"

echo "== hook"
printf '{"hook_event_name":"UserPromptSubmit","session_id":"x"}' | "$HOME/.claude/hooks/cc-handoff.sh"; rc=$?
chk "hook exits 0 outside a session (rc=$rc)" '[ $rc = 0 ]'

echo "== second account"
mkdir -p -m 700 "$HOME/.claude-work"; creds "$HOME/.claude-work"
# A stale grant for a folder the user never accepted (an older clx forced it): --init must clear it.
printf '{"oauthAccount":{"emailAddress":"bob@example.com"},"projects":{"/srv/untrusted":{"hasTrustDialogAccepted":true},"/srv/gone":{"hasTrustDialogAccepted":true}}}' >"$HOME/.claude-work/.claude.json"
"$HOME/.local/bin/clx" --init >"$T/init.out" 2>&1; rc=$?
chk "clx --init exits 0 (rc=$rc)" '[ $rc = 0 ]'
chk "settings.json linked into the account dir" "[ -L '$HOME/.claude-work/settings.json' ]"
chk "prefs copied, identity kept" "python3 -c \"import json;d=json.load(open('$HOME/.claude-work/.claude.json'));assert d['theme']=='dark' and d['oauthAccount']['emailAddress']=='bob@example.com'\""
chk "trust mirrored: copied, never granted, stale grant cleared" "python3 -c \"import json;p=json.load(open('$HOME/.claude-work/.claude.json'))['projects'];assert p['/srv/trusted'].get('hasTrustDialogAccepted') is True and p['/srv/untrusted'].get('hasTrustDialogAccepted') is not True and p['/srv/unseen'].get('hasTrustDialogAccepted') is not True and p['/srv/gone'].get('hasTrustDialogAccepted') is not True\""
"$HOME/.local/bin/clx" --status >"$T/status2.out" 2>&1; rc=$?
chk "status lists both accounts (rc=$rc)" "grep -qi alice '$T/status2.out' && grep -qi work '$T/status2.out'"
"$HOME/.local/bin/clx-move" --dry-run work >"$T/move.out" 2>&1; rc=$?
chk "clx-move answers JSON (rc=$rc)" "python3 -c \"import json;json.loads(open('$T/move.out').read().strip().splitlines()[-1])\""
"$HOME/.local/bin/cm-login" status >"$T/cm.out" 2>&1; rc=$?
chk "cm-login status lists work (rc=$rc)" "grep -q '^work ' '$T/cm.out'"
chk "cm-login status reads a logged-out answer" "grep -q '^work .*not logged in' '$T/cm.out'"
# A cloned repo with a json.py must not run code when cm-login is used inside it.
evil="$T/evil-repo"; mkdir -p "$evil"
printf 'import os\nopen(os.path.join(os.environ["HOME"], "PWNED"), "w").close()\nfrom _json import *\n' >"$evil/json.py"
(cd "$evil" && "$HOME/.local/bin/cm-login" status >/dev/null 2>&1)
chk "cm-login status in a repo with json.py runs none of its code" "[ ! -e '$HOME/PWNED' ]"
"$HOME/.local/bin/cm-login" 'Bad Name' >/dev/null 2>&1; rc=$?
chk "cm-login refuses a bad name" '[ $rc = 1 ]'

echo "== clx-openclaw (no systemd, no gateway: the sandbox has neither)"
mkdir -p "$HOME/.openclaw"
"$HOME/.local/bin/clx-openclaw" setup --with-skill --claude "$T/bin/claude" >"$T/oc-setup.out" 2>&1; rc=$?
SHIM="$HOME/.local/share/clx/openclaw/bin/claude"
chk "clx-openclaw setup exits 0 from the install (rc=$rc)" '[ $rc = 0 ]'
chk "it writes the shim and prints the lines to add" "[ -x '$SHIM' ] && grep -q 'CLAUDE_CODE_EXECUTABLE=' '$T/oc-setup.out'"
chk "it finds the installed skill and copies it" "cmp -s '$SKILL' '$HOME/.openclaw/skills/clx-accounts/SKILL.md'"
printf '' | "$SHIM" -p --input-format stream-json >"$T/oc-shim.out" 2>&1
chk "the shim reaches the CLI through clx, in a session dir" "grep -q 'STUB-CLAUDE dir=$HOME/.clx-sessions/' '$T/oc-shim.out'"

echo "== uninstall"
bash "$SRC/install.sh" --uninstall >"$T/uninstall.out" 2>&1; rc=$?
chk "uninstall exits 0 (rc=$rc)" '[ $rc = 0 ]'
chk "programs gone" "[ ! -e '$HOME/.local/bin/clx' ] && [ ! -e '$HOME/.local/bin/clx-move' ] && [ ! -e '$HOME/.local/bin/cm-login' ] && [ ! -e '$HOME/.local/bin/clx-openclaw' ]"
chk "the OpenClaw shim and both skill copies are gone" "[ ! -e '$SHIM' ] && [ ! -e '$SKILL' ] && [ ! -e '$HOME/.openclaw/skills/clx-accounts/SKILL.md' ]"
chk "hook entries gone, the rest kept" "[ \"\$(hooks)\" = '0 opus 1' ]"
chk "alias removed, the rest of .bashrc kept" "grep -qx 'export FOO=1' '$HOME/.bashrc' && ! grep -q 'clx claude alias' '$HOME/.bashrc'"
chk "logins untouched" "[ -f '$HOME/.claude-work/.credentials.json' ] && [ -f '$HOME/.claude/.credentials.json' ]"

printf '# >>> clx claude alias >>>\nkeep me\n' >"$HOME/.bashrc-half"
cp "$HOME/.bashrc-half" "$HOME/.bashrc"
bash "$SRC/install.sh" --uninstall >/dev/null 2>&1
chk "a half alias block (no end marker) is left as it was" "cmp -s '$HOME/.bashrc' '$HOME/.bashrc-half'"

# A full block followed by a stray start marker, and an end before a start: both
# would let a naive cut drop the user's own lines.
printf '# >>> clx claude alias >>>\nalias\n# <<< clx claude alias <<<\nmine 1\n# >>> clx claude alias >>>\nmine 2\n' >"$HOME/.bashrc-odd"
cp "$HOME/.bashrc-odd" "$HOME/.bashrc"
bash "$SRC/install.sh" --uninstall >/dev/null 2>&1
chk "unpaired markers after a full block: file left as it was" "cmp -s '$HOME/.bashrc' '$HOME/.bashrc-odd'"
printf 'mine 0\n# <<< clx claude alias <<<\nmine 1\n# >>> clx claude alias >>>\nmine 2\n' >"$HOME/.bashrc-odd2"
cp "$HOME/.bashrc-odd2" "$HOME/.bashrc"
bash "$SRC/install.sh" --uninstall >/dev/null 2>&1
chk "an end marker before the start: file left as it was" "cmp -s '$HOME/.bashrc' '$HOME/.bashrc-odd2'"

echo "install: $PASS passed, $FAIL failed  (sandbox $T)"
[ $FAIL = 0 ] || { echo "--- status1"; cat "$T/status1.out"; echo "--- launch2"; cat "$T/launch2.out"; echo "--- install"; cat "$T/install.out"; }
# Passed: drop the sandbox (it holds fake tokens). Failed: keep it to look at.
[ $FAIL = 0 ] && rm -rf "$T"
[ $FAIL = 0 ]
