#!/usr/bin/env python3
"""Sandbox assertions for clx's security fixes. Each check names the hole it closes.

Everything runs in test-dead-auth.py's throw-away HOME with FAKE tokens and no
network. Usage:  python3 test/test-security.py [--clx PATH] [--move PATH] [-v]
"""
import argparse
import importlib.machinery
import importlib.util
import json
import os
import shutil
import stat
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))


def load(name, path):
    loader = importlib.machinery.SourceFileLoader(name, path)
    spec = importlib.util.spec_from_loader(name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


sys.dont_write_bytecode = True
dead = load("dead_auth", os.path.join(HERE, "test-dead-auth.py"))
PASS = FAIL = 0
VERBOSE = False


def check(name, ok, detail=""):
    global PASS, FAIL
    if ok:
        PASS += 1
        if VERBOSE:
            print("PASS  %s" % name)
    else:
        FAIL += 1
        print("FAIL  %s%s" % (name, ("\n      " + detail) if detail else ""))


def mode(path):
    return stat.S_IMODE(os.lstat(path).st_mode)


def t_heal_watch_refuses_other_dirs(clx):
    """--heal-watch <dir> used to rmtree any dir it was given, in a detached daemon."""
    with dead.sandbox(clx) as box:
        victim = os.path.join(box.home, "precious")
        os.makedirs(victim)
        with open(os.path.join(victim, "keep.txt"), "w") as fh:
            fh.write("x")
        env = dict(os.environ)
        env.pop("CLX_NO_WATCH", None)
        env["HOME"] = box.home
        subprocess.run([sys.executable, "-I", clx, "--heal-watch", victim], env=env, timeout=20)
        time.sleep(1.5)  # the daemon would act within one tick
        check("--heal-watch on a non-session dir leaves it alone",
              os.path.isfile(os.path.join(victim, "keep.txt")))
        check("drop_session_dir refuses a dir outside ~/.clx-sessions",
              box.mod.drop_session_dir(victim) is False and os.path.isdir(victim))
        check("gc_one refuses a dir outside ~/.clx-sessions",
              box.mod.gc_one(victim) is False and os.path.isdir(victim))


def t_init_skips_claude_home(clx):
    """A ~/.claude-<name> symlink to ~/.claude used to turn settings.json into a self-loop."""
    with dead.sandbox(clx) as box:
        home_dir = os.path.join(box.home, ".claude")
        box.write_json(os.path.join(home_dir, "settings.json"), {"permissions": {"deny": ["Bash(rm:*)"]}})
        box.write_json(os.path.join(home_dir, ".credentials.json"), {"claudeAiOauth": dead.creds("alive")})
        os.makedirs(os.path.join(home_dir, "skills"))
        os.symlink(home_dir, os.path.join(box.home, ".claude-personal"))
        box.mod.cmd_init(quiet=True)
        settings = os.path.join(home_dir, "settings.json")
        try:
            with open(settings) as fh:
                deny = json.load(fh)["permissions"]["deny"]
        except Exception as exc:
            deny = repr(exc)
        check("settings.json stays a readable file with its deny rules",
              not os.path.islink(settings) and deny == ["Bash(rm:*)"], repr(deny))
        check("skills/ is not turned into a self-loop", os.path.isdir(os.path.join(home_dir, "skills"))
              and not os.path.islink(os.path.join(home_dir, "skills")))


def t_new_files_private(clx):
    """Temp files were world-readable mid-write and left behind on failure; history.jsonl too."""
    old_umask = os.umask(0o002)
    try:
        with dead.sandbox(clx) as box:
            target = os.path.join(box.home, "state.json")
            box.mod.write_json_atomic(target, {"a": 1})
            check("write_json_atomic: 0600", mode(target) == 0o600, oct(mode(target)))
            try:
                box.mod.write_json_atomic(target, {"bad": object()})
            except TypeError:
                pass
            left = [n for n in os.listdir(box.home) if n.startswith("state.json.tmp")]
            check("a failed write leaves no temp file", left == [], repr(left))

            box.account("aa", "alive", five=10, seven=10, age=30)
            conf, accts = box.accounts()
            sess = box.mod.create_session(accts[0], 90)
            history = os.path.join(box.home, ".claude", "history.jsonl")
            check("history.jsonl created 0600", mode(history) == 0o600, oct(mode(history)))
            check("the session's launch snapshot is written",
                  os.path.isfile(os.path.join(sess, box.mod.LAUNCH_PROJECTS)))
    finally:
        os.umask(old_umask)


def t_harvest_adds_only_new(clx):
    """Session GC used to copy an account dir's grants into ~/.claude.json."""
    with dead.sandbox(clx) as box:
        d = box.account("aa", "alive", five=10, seven=10, age=30)
        box.write_json(os.path.join(d, ".claude.json"), {
            "oauthAccount": {"emailAddress": "aa@example.test"},
            "projects": {"/srv/granted-elsewhere": {"hasTrustDialogAccepted": True,
                                                    "allowedTools": ["Bash(*)"]}}})
        box.write_json(os.path.join(box.home, ".claude.json"), {"theme": "dark", "projects": {}})
        conf, accts = box.accounts()
        sess = box.mod.create_session(accts[0], 90)
        cfg = os.path.join(sess, ".claude.json")
        with open(cfg) as fh:
            data = json.load(fh)
        data["projects"]["/srv/accepted-in-session"] = {"hasTrustDialogAccepted": True}
        box.write_json(cfg, data)
        box.mod.harvest_projects(cfg)
        with open(os.path.join(box.home, ".claude.json")) as fh:
            main = json.load(fh).get("projects", {})
        check("a folder the session added is kept", "/srv/accepted-in-session" in main, repr(sorted(main)))
        check("a grant the session started with is not copied into ~/.claude.json",
              "/srv/granted-elsewhere" not in main, repr(sorted(main)))


def t_notify_ends_options(clx):
    """An account name starting with '-' could be read as a notify-send option."""
    with dead.sandbox(clx) as box:
        fresh = load("clx_notify", clx)  # Box stubs notify(); this copy keeps the real one
        seen = []

        class FakeProc(object):
            def __init__(self, argv, **kw):
                seen.append(argv)

            def poll(self):
                return 0

        os.environ["DBUS_SESSION_BUS_ADDRESS"] = "unix:path=/nonexistent"
        os.environ.pop("CLX_NO_NOTIFY", None)
        real_which, real_popen = fresh.shutil.which, fresh.subprocess.Popen
        fresh.shutil.which = lambda name: "/usr/bin/notify-send"
        fresh.subprocess.Popen = FakeProc
        try:
            fresh.notify("-x moved", "body")
        finally:
            fresh.shutil.which, fresh.subprocess.Popen = real_which, real_popen
        argv = seen[0] if seen else []
        check("notify-send gets '--' before the summary",
              "--" in argv and argv.index("--") == argv.index("-x moved") - 1, repr(argv))


def t_move_waits_for_heal(clx, move_path):
    """clx-move used to replace a just-refreshed login before the watcher copied it home."""
    with dead.sandbox(clx) as box:
        move = load("clx_move_sec", move_path)
        box.account("aa", "alive", five=10, seven=10, age=30)
        box.account("bb", "alive", five=10, seven=10, age=30)
        conf, accts = box.accounts()
        sess = box.session_on("aa")
        link = os.path.join(sess, ".credentials.json")
        fresh = os.path.join(box.home, "refreshed.json")
        box.write_json(fresh, {"claudeAiOauth": dead.creds("alive")})
        os.unlink(link)
        shutil.copy(fresh, link)  # what Claude Code's refresh leaves: a regular file
        meta_conf = box.mod.load_conf()
        target = next(a for a in accts if a.id == "bb")
        got = move.move_one(box.mod, sess, target, accts, meta_conf, False)
        check("a session with an unsaved refresh is skipped as busy", got == "busy", repr(got))
        check("its refreshed login is untouched",
              os.path.isfile(link) and not os.path.islink(link))


def main():
    global VERBOSE
    ap = argparse.ArgumentParser()
    ap.add_argument("--clx", default=dead.DEFAULT_CLX)
    ap.add_argument("--move", default=os.path.join(HERE, "..", "clx-move"))
    ap.add_argument("-v", action="store_true")
    args = ap.parse_args()
    VERBOSE = args.v
    clx = os.path.abspath(args.clx)
    for test in (t_heal_watch_refuses_other_dirs, t_init_skips_claude_home, t_new_files_private,
                 t_harvest_adds_only_new, t_notify_ends_options):
        try:
            test(clx)
        except Exception as exc:
            check("%s raised" % test.__name__, False, "%s: %s" % (type(exc).__name__, exc))
    try:
        t_move_waits_for_heal(clx, os.path.abspath(args.move))
    except Exception as exc:
        check("t_move_waits_for_heal raised", False, "%s: %s" % (type(exc).__name__, exc))
    print("security: %d passed, %d failed  (%s)" % (PASS, FAIL, clx))
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
