#!/usr/bin/env python3
"""Sandbox assertions for clx-openclaw: setup, status, doctor and remove.

Nothing real is touched. Each case gets a throw-away HOME (with a space in it), a
fake `systemctl` that answers from a JSON file and logs every call, a fake /proc
holding one "gateway" process, stub Claude CLIs, and no network (HTTPS goes to a
closed port). No OpenClaw is installed or run. The gateway's fake environment
carries a planted secret: it must never appear in any output.

Usage:  python3 test/test-openclaw.py [--dir DIR] [-v]
        (DIR holds clx-openclaw, clx and openclaw/; default: the repo)
Exit 0 when every assertion passes.
"""
import argparse
import contextlib
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
PASS = FAIL = 0
VERBOSE = False
SRC = os.path.abspath(os.path.join(HERE, ".."))
SECRET = "FAKE-SECRET-VALUE-0123456789"
UNIT = "openclaw-gateway.service"
GATEWAY_PID = 424242
FORBIDDEN_VERBS = ("restart", "daemon-reload", "start", "stop", "reload", "enable", "disable",
                   "edit", "kill", "set-environment", "import-environment")


def check(name, ok, detail=""):
    global PASS, FAIL
    if ok:
        PASS += 1
        if VERBOSE:
            print("PASS  %s" % name)
    else:
        FAIL += 1
        print("FAIL  %s  %s" % (name, detail))


FAKE_SYSTEMCTL = r'''#!%(python)s -I
import json, os, sys
state = os.environ["FAKE_SYSTEMD_STATE"]
with open(os.environ["FAKE_SYSTEMD_LOG"], "a") as fh:
    fh.write(" ".join(sys.argv[1:]) + "\n")
args = sys.argv[1:]
if not args or args[0] != "--user":
    sys.exit(1)
args = args[1:]
data = json.load(open(state))
if args and args[0] == "show-environment":
    sys.stdout.write(data.get("manager_env", ""))
    sys.exit(0)
if args and args[0] == "show":
    unit = data.get("units", {}).get(args[1])
    props = [args[i + 1] for i, a in enumerate(args) if a == "-p"]
    value_only = "--value" in args
    for prop in props:
        if unit is None:
            val = {"LoadState": "not-found", "ActiveState": "inactive", "MainPID": "0"}.get(prop, "")
        elif prop == "Environment":
            # systemd shell-quotes an assignment that needs it (a space in a path).
            val = " ".join('"%%s"' %% a.replace("\\", "\\\\").replace('"', '\\"')
                           if any(c in a for c in ' "\\$') else a
                           for a in unit.get("Environment", []))
        else:
            val = str(unit.get(prop, ""))
        sys.stdout.write((val if value_only else "%%s=%%s" %% (prop, val)) + "\n")
    sys.exit(0)
sys.stderr.write("fake systemctl: refusing %%r\n" %% args)
sys.exit(3)
'''

STUB_CLAUDE = """#!/bin/sh
echo "STUB-CLAUDE %(tag)s dir=${CLAUDE_CONFIG_DIR:-<none>} args=$*"
"""

STUB_CLX = """#!%(python)s -I
CLX_VERSION = "1.1.0"
import os, sys
print("STUB-CLX bin=%%s drop=%%s quiet=%%s args=%%s" %% (
    os.environ.get("CC_CLAUDE_BIN"), os.environ.get("CLX_DROP_INJECTED_TOKEN"),
    os.environ.get("CLX_NO_NOTIFY"), " ".join(sys.argv[1:])))
"""


class Box(object):
    def __init__(self, src, clx=None):
        self.root = tempfile.mkdtemp(prefix="clx-openclaw-")
        self.home = os.path.join(self.root, "my home")
        self.src = src
        os.makedirs(os.path.join(self.home, ".claude"))
        os.makedirs(os.path.join(self.home, ".local", "bin"))
        os.makedirs(os.path.join(self.home, ".openclaw"))
        self.proc = os.path.join(self.root, "proc")
        self.sysbin = os.path.join(self.root, "sys", "usr", "bin")
        self.stub = os.path.join(self.root, "stub")
        for d in (self.proc, self.sysbin, self.stub):
            os.makedirs(d)
        self.state = os.path.join(self.root, "systemd.json")
        self.log = os.path.join(self.root, "systemctl.log")
        self.systemctl = os.path.join(self.stub, "systemctl")
        self.write(self.systemctl, FAKE_SYSTEMCTL % {"python": sys.executable}, 0o755)
        open(self.log, "w").close()
        self.clx = clx or os.path.join(src, "clx")
        self.outputs = []
        self.procs = []
        self.units = {}
        self.manager_env = "PATH=/usr/bin:/bin\nMANAGER_SECRET=%s\n" % SECRET
        self.flush()

    # -- the world -------------------------------------------------------------
    @staticmethod
    def write(path, text, mode=0o644):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as fh:
            fh.write(text)
        os.chmod(path, mode)

    def cli(self, path, tag="real"):
        self.write(path, STUB_CLAUDE % {"tag": tag}, 0o755)
        return path

    def flush(self):
        with open(self.state, "w") as fh:
            json.dump({"units": self.units, "manager_env": self.manager_env}, fh)

    def unit(self, path=None, running=True):
        env = ["SECRET_TOKEN=%s" % SECRET, "HOME=%s" % self.home]
        if path is not None:
            env.insert(0, "PATH=%s" % path)
        self.units[UNIT] = {"LoadState": "loaded", "ActiveState": "active" if running else "inactive",
                            "MainPID": str(GATEWAY_PID if running else 0), "Environment": env}
        self.flush()

    def gateway(self, path, pid=GATEWAY_PID, **env):
        """A gateway process in the fake /proc, its environment holding a planted secret."""
        d = os.path.join(self.proc, str(pid))
        os.makedirs(d, exist_ok=True)
        items = ["HOME=%s" % self.home, "PATH=%s" % path, "ANTHROPIC_OAUTH_TOKEN=%s" % SECRET,
                 "OPENCLAW_GATEWAY_TOKEN=%s" % SECRET]
        items += ["%s=%s" % kv for kv in env.items()]
        with open(os.path.join(d, "environ"), "wb") as fh:
            fh.write(b"\0".join(i.encode() for i in items) + b"\0")
        with open(os.path.join(d, "cmdline"), "wb") as fh:
            fh.write(b"node\0/opt/node_modules/openclaw/dist/index.js\0gateway\0--port\0018789\0")
        with open(os.path.join(d, "stat"), "w") as fh:
            fh.write("%d (node) S 1 %d %d 0 -1\n" % (pid, pid, pid))

    def child_of_gateway(self, pid):
        d = os.path.join(self.proc, str(pid))
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "stat"), "w") as fh:
            fh.write("%d (claude) S %d %d %d 0 -1\n" % (pid, GATEWAY_PID, pid, pid))

    def login(self, d, kind="alive", email="work@example.test"):
        os.makedirs(d, exist_ok=True)
        now_ms = time.time() * 1000
        if kind == "alive":
            doc = {"claudeAiOauth": {"accessToken": "fake-at", "refreshToken": "fake-rt",
                                     "expiresAt": now_ms + 8 * 3600e3,
                                     "refreshTokenExpiresAt": now_ms + 20 * 86400e3}}
        else:  # what Claude Code writes when it starts without a login: MCP sign-ins only
            doc = {"mcpOAuth": {"example-server|00": {"serverName": "example-server",
                                                      "accessToken": ""}}}
        self.write(os.path.join(d, ".credentials.json"), json.dumps(doc), 0o600)
        cfg = os.path.join(self.home, ".claude.json") if d.endswith(os.sep + ".claude") \
            else os.path.join(d, ".claude.json")
        self.write(cfg, json.dumps({"oauthAccount": {"emailAddress": email}}), 0o600)

    def env(self, **extra):
        env = {
            "HOME": self.home,
            "PATH": "%s:%s:/usr/bin:/bin" % (self.stub, os.path.join(self.home, ".local", "bin")),
            "CLX_OPENCLAW_CLX": self.clx,
            "CLX_OPENCLAW_PROC": self.proc,
            "CLX_OPENCLAW_SYSTEMCTL": self.systemctl,
            "CLX_OPENCLAW_SYSTEM_PATH": "%s:%s" % (self.sysbin, os.path.join(self.root, "sys", "bin")),
            "OPENCLAW_STATE_DIR": os.path.join(self.home, ".openclaw"),
            "FAKE_SYSTEMD_STATE": self.state,
            "FAKE_SYSTEMD_LOG": self.log,
            "CLX_NO_WATCH": "1",
            "CLX_NO_NOTIFY": "1",
            "HTTPS_PROXY": "http://127.0.0.1:9", "https_proxy": "http://127.0.0.1:9",
            "NO_PROXY": "", "no_proxy": "",
            "LANG": "C.UTF-8",
        }
        env.update(extra)
        return env

    def run(self, *args, **extra):
        """clx-openclaw <args> -> (rc, combined output)."""
        prog = os.path.join(self.src, "clx-openclaw")
        done = subprocess.run([sys.executable, "-I", prog] + list(args), env=self.env(**extra),
                              stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                              stderr=subprocess.STDOUT, timeout=60)
        out = done.stdout.decode("utf-8", "replace")
        self.outputs.append(out)
        if VERBOSE:
            print("$ clx-openclaw %s  (rc %d)\n%s" % (" ".join(args), done.returncode, out))
        return done.returncode, out

    def sleeper(self):
        proc = subprocess.Popen(["sleep", "60"])
        self.procs.append(proc)
        return proc.pid

    def close(self):
        for proc in self.procs:
            proc.kill()
            proc.wait()
        shutil.rmtree(self.root, ignore_errors=True)

    # -- what setup leaves behind ----------------------------------------------
    @property
    def shim(self):
        return os.path.join(self.home, ".local", "share", "clx", "openclaw", "bin", "claude")

    @property
    def dropin(self):
        return os.path.join(self.home, ".config", "systemd", "user", UNIT + ".d",
                            "zz-clx-openclaw.conf")

    def dropin_value(self, name):
        try:
            text = open(self.dropin).read()
        except OSError:
            return None
        found = re.search(r'^Environment="%s=((?:[^"\\]|\\.)*)"$' % name, text, re.M)
        if not found:
            return None
        return re.sub(r"\\(.)", r"\1", found.group(1)).replace("%%", "%")

    @property
    def envfile(self):
        return os.path.join(self.home, ".local", "share", "clx", "openclaw", "gateway.env")

    def envfile_value(self, name):
        try:
            text = open(self.envfile).read()
        except OSError:
            return None
        found = re.search(r'^%s="((?:[^"\\]|\\.)*)"$' % name, text, re.M)
        return re.sub(r"\\(.)", r"\1", found.group(1)) if found else None

    def systemctl_calls(self):
        return open(self.log).read().splitlines()


@contextlib.contextmanager
def sandbox(src, clx=None):
    box = Box(src, clx)
    try:
        yield box
    finally:
        box.close()


def no_secret(box, name):
    leaked = [o for o in box.outputs if SECRET in o]
    check("%s: the gateway's other environment values never reach the output" % name,
          not leaked, leaked[:1])


def no_restart(box, name):
    calls = box.systemctl_calls()
    bad = [c for c in calls if any(" %s" % v in " " + c for v in FORBIDDEN_VERBS)]
    check("%s: only read-only systemctl calls (no restart, no reload)" % name,
          not bad and all(c.startswith("--user show") for c in calls), bad or calls[-3:])


# ------------------------------------------------------------------- the cases


def t_usage(src):
    with sandbox(src) as box:
        rc, out = box.run()
        check("no command: usage and exit 2", rc == 2 and "setup" in out, (rc, out[-200:]))
        rc, out = box.run("status", "--unit", "bad unit;rm")
        check("a unit name with shell characters is refused (exit 2)", rc == 2, (rc, out[-200:]))


def t_link_route(src):
    """The usual npm layout: the CLI sits later on the PATH, a dir of yours comes first."""
    with sandbox(src) as box:
        local = os.path.join(box.home, ".local", "bin")
        npm = os.path.join(box.home, ".npm-global", "bin")
        real = box.cli(os.path.join(npm, "claude"))
        gw_path = "%s:%s:%s" % (local, npm, box.sysbin)
        box.unit(path=gw_path)
        box.gateway(gw_path)

        rc, out = box.run("doctor")
        check("before setup: doctor exits 1", rc == 1, (rc, out[-300:]))
        check("before setup: doctor names the main problem, with every claude on the PATH",
              "first `claude` is %s, not the clx shim" % real in out, out[-900:])

        rc, out = box.run("setup", "--dry-run")
        check("dry run: exit 0 and the plan is printed", rc == 0 and "would link" in out, out[-400:])
        check("dry run: nothing is written",
              not os.path.lexists(box.shim) and not os.path.lexists(os.path.join(local, "claude"))
              and not os.path.lexists(box.dropin), os.listdir(local))

        rc, out = box.run("setup")
        link = os.path.join(local, "claude")
        check("setup: exit 0", rc == 0, out[-600:])
        check("setup: a link named claude in the first dir of yours on the gateway's PATH",
              os.path.islink(link) and os.path.realpath(link) == os.path.realpath(box.shim), out[-400:])
        check("setup: the shim is executable and names the real CLI",
              os.access(box.shim, os.X_OK) and ("CLX_OPENCLAW_REAL='%s'" % real) in open(box.shim).read())
        check("setup: the real CLI is left exactly where it was",
              open(real).read().startswith("#!/bin/sh") and not os.path.islink(real))
        check("setup: the drop-in sets CLAUDE_CODE_EXECUTABLE to the shim and leaves PATH alone",
              box.dropin_value("CLAUDE_CODE_EXECUTABLE") == box.shim and box.dropin_value("PATH") is None,
              open(box.dropin).read() if os.path.exists(box.dropin) else "no drop-in")
        check("setup: the drop-in names clx's environment file, optional ('-'), last",
              ("EnvironmentFile=-%s" % box.envfile) in open(box.dropin).read()
              and open(box.dropin).read().rstrip().endswith(box.envfile))
        check("setup: the environment file holds CLAUDE_CODE_EXECUTABLE and no PATH (link route)",
              box.envfile_value("CLAUDE_CODE_EXECUTABLE") == box.shim and box.envfile_value("PATH") is None,
              open(box.envfile).read() if os.path.exists(box.envfile) else "no env file")
        check("setup: it says the link also routes shells and cron through clx",
              "Shells and cron jobs" in out, out[-500:])
        check("setup: it prints the ONE restart command and runs nothing",
              "systemctl --user daemon-reload && systemctl --user restart %s" % UNIT in out
              and "Nothing was restarted" in out, out[-300:])
        no_restart(box, "setup")

        # The gateway after the restart the person ran.
        box.gateway(gw_path, CLAUDE_CODE_EXECUTABLE=box.shim)
        pid = box.sleeper()
        sess = os.path.join(box.home, ".clx-sessions", str(pid))
        os.makedirs(sess)
        box.write(os.path.join(sess, "clx-session.json"),
                  json.dumps({"pid": pid, "started_at": int(time.time()) - 120, "account_id": "work",
                              "account_name": "Work", "handoffs": [{"to": "Work"}]}), 0o600)
        box.child_of_gateway(pid)
        box.write(os.path.join(box.home, ".claude", "clx-handoff.log"),
                  "2026-01-01T10:00:00  %d  failed turn on Home (limit): You've hit your weekly "
                  "limit  watch\n2026-01-01T10:00:00  %d  Home (7d 100%%) -> Work (worst 5h 3%%)  "
                  "watch\n2026-01-01T10:05:00  %d  heal relink: was x, now y  watch\n" % (pid, pid, pid))
        rc, out = box.run("status")
        check("status: the gateway is running, found through systemd",
              rc == 0 and "running, pid %d (systemd user unit %s)" % (GATEWAY_PID, UNIT) in out, out[:400])
        check("status: every claude on the running gateway's PATH, in order, the shim first",
              re.search(r"1\. %s\s+<- the clx shim\n\s+2\. %s" % (re.escape(link), re.escape(real)), out)
              and "ok: its Claude CLI turns go through clx" in out, out)
        check("status: CLAUDE_CODE_EXECUTABLE is reported as a yes/no, never as its value",
              "CLAUDE_CODE_EXECUTABLE points at the shim" in out, out)
        check("status: the live session, its account, and that the gateway runs it",
              re.search(r"\n\s+%d\s+on Work\s+started 2m ago\s+hand-offs 1\s+\(gateway\)" % pid, out), out)
        check("status: the last failed-turn move from the hand-off log, nothing else from it",
              "failed turn on Home (limit)" in out and "Home (7d 100%) -> Work" in out
              and "heal relink" not in out, out[-500:])

        rc, out = box.run("doctor")
        check("after setup and restart: doctor exits 0", rc == 0 and "0 problems" in out, out[-1200:])
        check("doctor: always says what clx does not cover",
              "Not covered:" in out and "auth profile" in out and "API key" in out, out[-600:])

        rc, out = box.run("setup")
        check("setup again: nothing doubles up",
              rc == 0 and "already resolves `claude` to the shim first" in out
              and len([n for n in os.listdir(local) if n == "claude"]) == 1, out[-500:])

        rc, out = box.run("remove")
        check("remove: exit 0, link, shim, drop-in and environment file gone",
              rc == 0 and not os.path.lexists(link) and not os.path.lexists(box.shim)
              and not os.path.lexists(box.dropin) and not os.path.lexists(box.envfile), out)
        check("remove: the real CLI stays", os.path.isfile(real))
        check("remove: it prints the restart command", "systemctl --user restart %s" % UNIT in out, out)
        no_restart(box, "status, doctor and remove")
        no_secret(box, "link route")


def t_path_route(src):
    """The native installer layout: the real CLI is the FIRST claude. Never replace it."""
    with sandbox(src) as box:
        local = os.path.join(box.home, ".local", "bin")
        real = box.cli(os.path.join(local, "claude"))
        odd = os.path.join(box.root, "odd%dir")   # a % must reach systemd as %%
        os.makedirs(odd)
        gw_path = "%s:%s:/usr/bin" % (local, odd)
        box.unit(path=gw_path, running=False)

        rc, out = box.run("setup")
        check("path route: exit 0", rc == 0, out[-600:])
        check("path route: the real CLI is never replaced or moved",
              not os.path.islink(real) and "STUB-CLAUDE real" in open(real).read())
        want = "%s:%s" % (os.path.dirname(box.shim), gw_path)
        check("path route: the drop-in puts the shim dir first on the unit's PATH",
              box.dropin_value("PATH") == want, (box.dropin_value("PATH"), want))
        check("path route: % is written as %% in the unit file",
              "odd%%dir" in open(box.dropin).read(), open(box.dropin).read())
        check("path route: the environment file carries the same PATH, % as it is (no specifiers there)",
              box.envfile_value("PATH") == want and "odd%dir" in open(box.envfile).read()
              and "odd%%dir" not in open(box.envfile).read(), open(box.envfile).read())
        check("path route: a HOME with a space is quoted, CLAUDE_CODE_EXECUTABLE is the shim",
              box.dropin_value("CLAUDE_CODE_EXECUTABLE") == box.shim and " " in box.shim)
        check("path route: the unit's PATH was read, the gateway was not running",
              "read from the unit %s" % UNIT in out, out[:300])
        check("path route: the drop-in is the gateway's only, so no shell warning",
              "Shells and cron jobs" not in out and "puts %s first" % os.path.dirname(box.shim) in out, out)

        rc, out = box.run("doctor")
        check("path route: doctor cannot check a stopped gateway's PATH and says so",
              "the gateway is not running" in out, out[-900:])

        # Restart pending: the gateway runs, but still with its old PATH.
        box.unit(path=gw_path, running=True)
        box.gateway(gw_path)
        rc, out = box.run("doctor")
        check("path route: a gateway still on its old PATH is the problem, with both causes named",
              rc == 1 and "If the gateway was not restarted since" in out
              and "systemctl --user cat %s" % UNIT in out and "first `claude` is %s" % real in out,
              out[-900:])

        # After the restart the gateway's PATH is the drop-in's.
        box.gateway(want, CLAUDE_CODE_EXECUTABLE=box.shim)
        rc, out = box.run("doctor")
        check("path route: after the restart doctor is happy", rc == 0, out[-900:])
        os.unlink(box.envfile)
        rc, out = box.run("doctor")
        check("path route: a missing environment file is a problem",
              rc == 1 and "which is missing" in out, out[-600:])
        rc, out = box.run("setup")
        check("path route: setup again keeps the same PATH (no doubled shim dir)",
              rc == 0 and box.dropin_value("PATH") == want, box.dropin_value("PATH"))

        rc, out = box.run("setup", "--no-link")
        check("--no-link: still the drop-in route", rc == 0 and box.dropin_value("PATH") == want)
        no_restart(box, "path route")
        no_secret(box, "path route")

    with sandbox(src) as box:
        local = os.path.join(box.home, ".local", "bin")
        npm = os.path.join(box.home, ".npm-global", "bin")
        box.cli(os.path.join(npm, "claude"))
        gw_path = "%s:%s" % (local, npm)
        box.unit(path=gw_path)
        box.gateway(gw_path)
        rc, out = box.run("setup", "--no-link")
        check("--no-link: no link even where one would win, PATH in the drop-in instead",
              rc == 0 and not os.path.lexists(os.path.join(local, "claude"))
              and (box.dropin_value("PATH") or "").startswith(os.path.dirname(box.shim) + ":"), out[-400:])


def t_refusals(src):
    with sandbox(src) as box:
        npm = os.path.join(box.home, ".npm-global", "bin")
        box.cli(os.path.join(npm, "claude"))
        box.unit(path=npm)
        box.gateway(npm)
        os.makedirs(os.path.dirname(box.dropin))
        box.write(box.dropin, "[Service]\nEnvironment=MINE=1\n")
        rc, out = box.run("setup")
        check("a drop-in of the same name without the marker: refused, exit 1",
              rc == 1 and "not clx-openclaw's" in out, out)
        check("...and NOTHING was written (no shim either)",
              open(box.dropin).read() == "[Service]\nEnvironment=MINE=1\n" and not os.path.lexists(box.shim))
        rc, out = box.run("remove")
        check("remove leaves a drop-in that is not its own",
              rc == 0 and os.path.isfile(box.dropin) and "kept" in out, out)

    with sandbox(src) as box:
        npm = os.path.join(box.home, ".npm-global", "bin")
        box.cli(os.path.join(npm, "claude"))
        box.unit(path=npm)
        box.write(box.envfile, "PATH=/mine\n")
        rc, out = box.run("setup")
        check("an environment file of the same name without the marker: refused",
              rc == 1 and "not clx-openclaw's" in out and open(box.envfile).read() == "PATH=/mine\n", out)

    with sandbox(src) as box:
        npm = os.path.join(box.home, ".npm-global", "bin")
        box.cli(os.path.join(npm, "claude"))
        box.unit(path=npm)
        box.write(box.shim, "#!/bin/sh\necho mine\n", 0o755)
        rc, out = box.run("setup")
        check("a file at the shim's path that is not ours: refused", rc == 1 and "not clx-openclaw's" in out, out)
        rc, out = box.run("remove")
        check("remove leaves it too", os.path.isfile(box.shim) and "mine" in open(box.shim).read(), out)

    with sandbox(src) as box:
        box.unit(path="/nonexistent")
        rc, out = box.run("setup", PATH=box.stub)
        check("no Claude CLI anywhere: refused with the fix",
              rc == 1 and "--claude PATH" in out, out)

    with sandbox(src) as box:
        npm = os.path.join(box.home, ".npm-global", "bin")
        box.cli(os.path.join(npm, "claude"))
        box.unit(path=npm)
        rc, out = box.run("setup", CLX_OPENCLAW_CLX=os.path.join(box.root, "no-clx"))
        check("no clx installed: refused", rc == 1 and "install.sh" in out, out)
        old = os.path.join(box.root, "old-clx")
        box.write(old, 'CLX_VERSION = "1.0.1"\n', 0o755)
        rc, out = box.run("setup", CLX_OPENCLAW_CLX=old)
        check("a clx older than 1.1.0: refused", rc == 1 and "1.1.0 or newer" in out, out)


def t_no_systemd(src):
    with sandbox(src) as box:
        npm = os.path.join(box.home, ".npm-global", "bin")
        box.cli(os.path.join(npm, "claude"))
        rc, out = box.run("setup", "--claude", os.path.join(npm, "claude"),
                          CLX_OPENCLAW_SYSTEMCTL=os.path.join(box.root, "no-systemctl"))
        check("no systemd: exit 0, the shim is written, no drop-in",
              rc == 0 and os.access(box.shim, os.X_OK) and not os.path.lexists(box.dropin), out)
        check("no systemd: it prints the lines to add instead",
              "PATH=%s:$PATH" % os.path.dirname(box.shim) in out
              and "CLAUDE_CODE_EXECUTABLE=%s" % box.shim in out, out)
        rc, out = box.run("status", CLX_OPENCLAW_SYSTEMCTL=os.path.join(box.root, "no-systemctl"))
        check("no systemd: status says no gateway was found", rc == 0 and "not found" in out, out[:300])

    with sandbox(src) as box:
        # No unit, but a gateway process of this user is running.
        local = os.path.join(box.home, ".local", "bin")
        npm = os.path.join(box.home, ".npm-global", "bin")
        box.cli(os.path.join(npm, "claude"))
        box.gateway("%s:%s" % (local, npm))
        rc, out = box.run("setup")
        check("no unit, a running gateway process: its PATH is used and the link route taken",
              rc == 0 and os.path.islink(os.path.join(local, "claude"))
              and "running gateway (pid %d)" % GATEWAY_PID in out, out)
        check("...and only CLAUDE_CODE_EXECUTABLE is left to add by hand",
              "CLAUDE_CODE_EXECUTABLE=%s" % box.shim in out and "PATH=" not in out.split("by hand")[-1]
              and "$PATH" not in out, out)
        no_secret(box, "no systemd")


def t_doctor_problems(src):
    with sandbox(src) as box:
        local = os.path.join(box.home, ".local", "bin")
        npm = os.path.join(box.home, ".npm-global", "bin")
        real = box.cli(os.path.join(npm, "claude"))
        stray = box.cli(os.path.join(box.sysbin, "claude"), tag="system")
        gw_path = "%s:%s:%s" % (local, npm, box.sysbin)
        box.unit(path=gw_path)
        box.gateway(gw_path)
        rc, out = box.run("setup")
        # The gateway restarted - with the watcher switched off in its environment.
        box.gateway(gw_path, CLAUDE_CODE_EXECUTABLE=box.shim, CLX_NO_FAIL_SCAN="1",
                    ANTHROPIC_API_KEY="sk-" + SECRET)
        # A login-less default dir next to the same account's live named dir.
        box.login(os.path.join(box.home, ".claude"), "mcp-only", "work@example.test")
        box.login(os.path.join(box.home, ".claude-work"), "alive", "work@example.test")

        rc, out = box.run("doctor")
        check("doctor: exit 1 with problems", rc == 1, out[-300:])
        check("doctor: a claude on the PATH system services and cron use",
              "%s is on the PATH that system services and cron use" % stray in out, out)
        check("doctor: the watcher switched off in the running gateway (name only)",
              "CLX_NO_FAIL_SCAN is set in the running gateway's environment" in out, out)
        check("doctor: a forwarded API key is named as a bypass risk, never shown",
              "ANTHROPIC_API_KEY is set in the running gateway's environment" in out, out)
        check("doctor: the dead (login-less) default next to the live named login",
              re.search(r"\.claude holds a dead login \(logged out\) of the account .*\.claude-work", out),
              out)

        os.chmod(box.shim, 0o644)
        rc, out = box.run("doctor")
        check("doctor: a shim that is not executable", "is not executable" in out, out)
        os.chmod(box.shim, 0o755)
        os.unlink(real)
        rc, out = box.run("doctor")
        check("doctor: a shim whose CLI is gone", "which is not there any more" in out, out)
        os.unlink(box.shim)
        rc, out = box.run("doctor")
        check("doctor: a missing shim", "the shim %s is missing" % box.shim in out, out)
        rc, out = box.run("doctor", CLX_NO_FAIL_SCAN="1")
        check("doctor: the watcher switched off in this shell", "CLX_NO_FAIL_SCAN is set in this shell" in out, out)
        no_restart(box, "doctor")
        no_secret(box, "doctor")


def t_shim(src):
    """The generated shim itself, against a stub clx and then the real one."""
    with sandbox(src) as box:
        npm = os.path.join(box.home, ".npm-global", "bin")
        real = box.cli(os.path.join(npm, "claude"))
        stub = os.path.join(box.root, "stub-clx")
        box.write(stub, STUB_CLX % {"python": sys.executable}, 0o755)
        box.unit(path=npm)
        rc, out = box.run("setup", CLX_OPENCLAW_CLX=stub)
        check("shim: set up against a stub clx", rc == 0, out[-300:])

        def shim(*args, **env):
            full = box.env(**env)
            done = subprocess.run([box.shim] + list(args), env=full, stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=60)
            return done.stdout.decode("utf-8", "replace")

        out = shim("-p", "hi", CC_CLAUDE_BIN=box.shim)
        check("shim: hands the launch to clx with the real CLI pinned, token dropping and no notices",
              "STUB-CLX bin=%s drop=1 quiet=1 args=-p hi" % real in out, out)
        check("shim: a CC_CLAUDE_BIN pointing at the shim cannot make it loop", "bin=%s " % real in out)
        if shutil.which("script"):
            # On a terminal (a person whose shell resolves the link), notices stay on.
            plain = box.env()
            plain.pop("CLX_NO_NOTIFY")
            done = subprocess.run(["script", "-qec", "%s -p hi" % shlex.quote(box.shim), "/dev/null"],
                                  env=plain, stdin=subprocess.DEVNULL,
                                  stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=60)
            tty = done.stdout.decode("utf-8", "replace")
            check("shim: on a terminal it leaves clx's notices on", "quiet=None" in tty, tty)
        out = shim("-p", "hi", ANTHROPIC_API_KEY="fake-key")
        check("shim: with ANTHROPIC_API_KEY the caller chose: straight to the real CLI",
              "STUB-CLAUDE real dir=<none> args=-p hi" in out, out)
        out = shim("-p", "hi", CLAUDE_CODE_OAUTH_TOKEN="fake-token")
        check("shim: with CLAUDE_CODE_OAUTH_TOKEN as well", "STUB-CLAUDE real" in out, out)
        os.unlink(stub)
        out = shim("-p", "hi")
        check("shim: without clx the gateway still gets its CLI", "STUB-CLAUDE real" in out, out)

    with sandbox(src) as box:
        npm = os.path.join(box.home, ".npm-global", "bin")
        box.cli(os.path.join(npm, "claude"))
        box.unit(path=npm)
        box.login(os.path.join(box.home, ".claude"), "alive", "solo@example.test")
        rc, out = box.run("setup")
        check("shim + real clx: set up", rc == 0, out[-300:])
        argv = ["-p", "--input-format", "stream-json", "--output-format", "stream-json",
                "--settings", '{"disableAllHooks":true}']
        done = subprocess.run([box.shim] + argv, env=box.env(), stdin=subprocess.PIPE,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
        out = done.stdout.decode("utf-8", "replace")
        err = done.stderr.decode("utf-8", "replace")
        sessions = os.path.join(box.home, ".clx-sessions")
        check("shim + real clx: a gateway-style launch on pipes reaches the CLI in a clx session dir",
              ("STUB-CLAUDE real dir=%s/" % sessions) in out and "args=%s" % " ".join(argv) in out,
              (out[-300:], err[-500:]))
        check("shim + real clx: no traceback", "Traceback" not in out + err, err[-500:])
        done = subprocess.run([box.shim, "-p", "hi"], env=box.env(
            CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR="9"), stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
        err = done.stderr.decode("utf-8", "replace")
        check("shim + real clx: a token the gateway forwards on a descriptor is dropped, clx chooses",
              "ignoring the injected CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR" in err, err[-400:])


def t_skill(src):
    path = os.path.join(src, "openclaw", "skills", "clx-accounts", "SKILL.md")
    text = open(path).read()
    front = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    fields = dict(line.split(": ", 1) for line in (front.group(1).splitlines() if front else [])
                  if ": " in line)
    check("skill: frontmatter first, with name and description",
          front and fields.get("name") == "clx-accounts" and fields.get("description"), fields)
    check("skill: the directory name is the name, the description is one line under 160 chars",
          os.path.basename(os.path.dirname(path)) == fields.get("name")
          and len(fields.get("description", "")) < 160)
    check("skill: carries the marker, so remove can tell it is its own",
          "clx-openclaw managed file" in text)
    with sandbox(src) as box:
        npm = os.path.join(box.home, ".npm-global", "bin")
        box.cli(os.path.join(npm, "claude"))
        box.unit(path=npm)
        rc, out = box.run("setup", "--with-skill")
        dst = os.path.join(box.home, ".openclaw", "skills", "clx-accounts", "SKILL.md")
        check("--with-skill: installed into <state-dir>/skills/<name>/SKILL.md",
              rc == 0 and os.path.isfile(dst) and open(dst).read() == text, out[-400:])
        check("--with-skill: it says new sessions see it", "new sessions see it" in out, out[-300:])
        rc, out = box.run("remove")
        check("remove: the skill goes too", rc == 0 and not os.path.exists(dst), out)
        shutil.rmtree(os.path.join(box.home, ".openclaw"))
        rc, out = box.run("setup", "--with-skill")
        check("--with-skill without an OpenClaw state dir: refused, says --state-dir",
              rc == 1 and "--state-dir" in out, out)


def main():
    global VERBOSE, SRC
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=SRC)
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()
    VERBOSE = args.verbose
    SRC = os.path.abspath(args.dir)
    for case in (t_usage, t_link_route, t_path_route, t_refusals, t_no_systemd,
                 t_doctor_problems, t_shim, t_skill):
        try:
            case(SRC)
        except Exception as exc:
            import traceback
            check("%s raised" % case.__name__, False,
                  "%s: %s\n%s" % (type(exc).__name__, exc, traceback.format_exc()[-1200:]))
    print("openclaw: %d passed, %d failed  (%s)" % (PASS, FAIL, os.path.join(SRC, "clx-openclaw")))
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
