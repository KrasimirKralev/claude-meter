#!/usr/bin/env python3
"""Sandbox assertions for clx-move: every running clx session moved to ONE account
on request (a click on that account in Claude Meter, 2026-11-12).

clx-move is a separate file that IMPORTS clx - the lock, the session lookup and
perform_handoff are clx's own - so clx itself is not edited. These run it against
whichever clx is named (the repo copy by default, `--clx PATH` for another
one) inside test-dead-auth.py's throw-away HOME: fake tokens, no network,
and never a real ~/.clx-sessions.

Usage:  python3 test/test-move.py [--clx PATH] [--move PATH] [-v]
Exit 0 when every assertion passes.
"""
import argparse
import importlib.machinery
import importlib.util
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def load(name, path):
    loader = importlib.machinery.SourceFileLoader(name, path)
    spec = importlib.util.spec_from_loader(name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


dead = load("dead_auth", os.path.join(HERE, "test-dead-auth.py"))
sandbox, NOW = dead.sandbox, dead.NOW
PASS = FAIL = 0
VERBOSE = False
MOVE = None      # the clx-move module


def check(name, ok, detail=""):
    global PASS, FAIL
    if ok:
        PASS += 1
        if VERBOSE:
            print("PASS  %s" % name)
    else:
        FAIL += 1
        print("FAIL  %s  %s" % (name, detail))


def measured(box, aid, seven=None, fable=None, kind="alive"):
    d = box.account(aid, kind)
    windows = {}
    if seven is not None:
        windows["seven_day"] = {"utilization": seven, "resets_at": None, "label": "7d"}
    if fable is not None:
        windows["weekly_fable"] = {"utilization": fable, "resets_at": None, "label": "Weekly (Fable)",
                                   "model": "Fable", "model_family": "fable"}
    box.cache[aid] = {"five_hour": None, "seven_day": seven, "resets_at": None, "windows": windows,
                      "fetchedAt": int(NOW - 30), "status": "ok", "checkedAt": int(NOW),
                      "email": "%s@example.test" % aid, "dir": d}
    box.flush_cache()
    return d


class Others(object):
    """Extra live sessions: each needs a pid that is alive and is not this test's."""

    def __init__(self, box):
        self.box, self.procs = box, []

    def session_on(self, aid, **meta_extra):
        proc = subprocess.Popen(["sleep", "600"])
        self.procs.append(proc)
        m = self.box.mod
        path = os.path.join(m.SESSIONS_ROOT, str(proc.pid))
        os.makedirs(path, exist_ok=True)
        acct_dir = os.path.join(self.box.home, ".claude-" + aid)
        m.point_credentials(path, acct_dir)
        shutil.copy(os.path.join(acct_dir, ".claude.json"), os.path.join(path, ".claude.json"))
        meta = {"pid": proc.pid, "started_at": int(NOW) - 3600, "account_id": aid, "account_dir": acct_dir,
                "account_name": aid.title(), "threshold": 90.0, "handoffs": [], "last_handoff_at": 0}
        meta.update(meta_extra)
        m.write_session_meta(path, meta)
        return path

    def close(self):
        for proc in self.procs:
            proc.kill()
            proc.wait()


def three(box):
    measured(box, "yk", seven=30)
    measured(box, "mk", seven=40)
    measured(box, "kr", seven=20)


def move(box, name, **kw):
    kw.setdefault("wait", 0.01)
    return MOVE.move_all(box.mod, name, **kw)


def active(box):
    try:
        with open(box.mod.ACTIVE_FILE) as fh:
            return json.load(fh)
    except Exception:
        return {}


# ------------------------------------------------------------------- the cases


def t_moves_all(clx):
    with sandbox(clx) as box:
        three(box)
        others = Others(box)
        try:
            mine = box.session_on("yk")
            other = others.session_on("mk")
            res = move(box, "kr")
            check("two sessions on two accounts: both are moved", res.get("ok") and len(res.get("moved", [])) == 2, str(res))
            check("their credentials links point into the account asked for",
                  box.link_target(mine) == ".claude-kr" and box.link_target(other) == ".claude-kr",
                  "%s %s" % (box.link_target(mine), box.link_target(other)))
            check("each session's own record says so, as a move made by hand",
                  all(box.meta(s).get("account_id") == "kr" and box.meta(s)["handoffs"][-1]["event"] == "manual"
                      and box.meta(s)["handoffs"][-1]["to"] == "Kr" for s in (mine, other)),
                  str(box.meta(mine).get("handoffs")))
            check("the launcher's record names it, with a session: Claude Meter's Active follows",
                  active(box).get("id") == "kr" and active(box).get("session_dir") in (mine, other), str(active(box))[:200])
            check("no desktop notification: the meter that was clicked says it", box.notes == [], str(box.notes))
            said = box.hook(mine, "prompt")
            check("the next prompt tells the model once, and the session stays where it was put",
                  "this session moved from" in said and "Kr" in said and box.link_target(mine) == ".claude-kr", repr(said))
            check("and says nothing the prompt after", box.hook(mine, "prompt") == "", "")
            again = move(box, "kr")
            check("asked again: nothing to move, both already there",
                  again.get("ok") and again.get("moved") == [] and len(again.get("already", [])) == 2
                  and len(box.meta(mine)["handoffs"]) == 1, str(again))
        finally:
            others.close()


def t_names(clx):
    with sandbox(clx) as box:
        three(box)
        for name in ("kr", "Kr", "KR", "kr@example.test"):
            box.session_on("yk")
            res = move(box, name)
            check("the account is found the way `clx --use` finds it: %r" % name,
                  res.get("ok") and res.get("target") == "Kr", str(res))
        res = move(box, "nobody")
        check("an account clx does not have: refused, and it says which it has",
              not res.get("ok") and "nobody" in res.get("error", "") and "Yk" in res.get("error", ""), str(res))
        check("an empty name is refused too", not move(box, "").get("ok"))


def t_refuses_spent(clx):
    with sandbox(clx) as box:
        three(box)
        measured(box, "kr", seven=95)
        mine = box.session_on("yk")
        res = move(box, "kr")
        check("an account over clx's threshold: refused, clx would move the sessions off again",
              not res.get("ok") and "95" in res.get("error", "") and "90" in res.get("error", ""), str(res))
        check("and nothing was touched",
              box.link_target(mine) == ".claude-yk" and box.meta(mine)["handoffs"] == [] and not active(box), "")
        box.session_on("kr")
        res = move(box, "kr")
        check("a session that is ALREADY on a full account is not a refusal", res.get("ok") and res.get("already"), str(res))
    with sandbox(clx) as box:
        three(box)
        measured(box, "kr", seven=20, fable=92)
        mine = box.session_on("yk")
        box.mod.session_model = lambda payload=None: "fable"
        res = move(box, "kr")
        check("a cap that binds the session's own model counts: a Fable session is not sent to a spent Fable cap",
              not res.get("ok") and "Fable" in res.get("error", "") and box.link_target(mine) == ".claude-yk", str(res))
        box.mod.session_model = lambda payload=None: "opus"
        res = move(box, "kr")
        check("the same account takes a session on another model",
              res.get("ok") and box.link_target(mine) == ".claude-kr", str(res))
    with sandbox(clx) as box:
        three(box)
        measured(box, "kr", seven=20, fable=92)
        others = Others(box)
        try:
            mine = box.session_on("yk", transcript_path="/t/fable.jsonl")
            other = others.session_on("mk", transcript_path="/t/opus.jsonl")
            box.mod.session_model = lambda payload=None: (
                "fable" if "fable" in ((payload or {}).get("transcript_path") or "") else "opus")
            res = move(box, "kr")
            check("each session by its own model: the Opus one goes, the Fable one stays and is named with the reason",
                  res.get("ok") and res.get("moved") == [os.path.basename(other)]
                  and box.link_target(mine) == ".claude-yk" and box.link_target(other) == ".claude-kr"
                  and res["skipped"] and res["skipped"][0]["pid"] == os.path.basename(mine)
                  and "Fable" in res["skipped"][0]["why"], str(res))
            check("the session that stayed has no hand-off on its record", box.meta(mine)["handoffs"] == [], "")
        finally:
            others.close()


def t_refuses_unusable(clx):
    with sandbox(clx) as box:
        three(box)
        measured(box, "kr", seven=5, kind="expired")
        mine = box.session_on("yk")
        res = move(box, "kr")
        check("a logged-out account: refused with clx's own words",
              not res.get("ok") and ("login" in res.get("error", "") or "logged" in res.get("error", ""))
              and box.link_target(mine) == ".claude-yk", str(res))
    with sandbox(clx) as box:
        three(box)
        box.conf(paused={"kr": {"until": None, "since": int(NOW), "reason": "lent out"}})
        mine = box.session_on("yk")
        res = move(box, "kr")
        check("a parked account: refused", not res.get("ok") and "parked" in res.get("error", "")
              and box.link_target(mine) == ".claude-yk", str(res))


def t_no_sessions(clx):
    with sandbox(clx) as box:
        three(box)
        res = move(box, "kr")
        check("no session running: nothing moved, and it says so",
              res.get("ok") and res.get("moved") == [] and res.get("sessions") == 0 and not active(box), str(res))
        stale = os.path.join(box.mod.SESSIONS_ROOT, "999999991")
        os.makedirs(stale)
        box.mod.write_session_meta(stale, {"pid": 999999991, "account_id": "yk",
                                           "account_dir": os.path.join(box.home, ".claude-yk")})
        res = move(box, "kr")
        check("a session dir whose process is gone is not a session", res.get("sessions") == 0, str(res))


def t_dry_run(clx):
    with sandbox(clx) as box:
        three(box)
        mine = box.session_on("yk")
        res = move(box, "kr", dry_run=True)
        check("a dry run names what would move and changes nothing",
              res.get("ok") and len(res.get("moved", [])) == 1 and res.get("dry_run") is True
              and box.link_target(mine) == ".claude-yk" and box.meta(mine)["handoffs"] == [] and not active(box), str(res))


def t_busy(clx):
    with sandbox(clx) as box:
        three(box)
        mine = box.session_on("yk")
        with box.mod.SessionLock(mine) as held:
            assert held.held
            res = move(box, "kr", retries=3)
        check("a session somebody else is writing is left alone and reported, not waited on forever",
              res.get("ok") and res.get("moved") == [] and res.get("skipped") and "busy" in res["skipped"][0]["why"]
              and box.link_target(mine) == ".claude-yk", str(res))
        res = move(box, "kr")
        check("and the next click moves it", res.get("moved") and box.link_target(mine) == ".claude-kr", str(res))


def t_cli(clx, move_path):
    with sandbox(clx) as box:
        three(box)
        mine = box.session_on("yk")
        env = dict(os.environ, CLX_MOVE_CLX=clx)
        run = subprocess.run([sys.executable, move_path, "--dry-run", "kr"], capture_output=True, text=True, env=env)
        try:
            out = json.loads(run.stdout)
        except ValueError:
            out = {}
        check("the command prints one JSON object and exits 0 when it decided",
              run.returncode == 0 and out.get("ok") and out.get("dry_run") and out.get("target") == "Kr",
              "%s %r %r" % (run.returncode, run.stdout[:200], run.stderr[:200]))
        run = subprocess.run([sys.executable, move_path, "nobody"], capture_output=True, text=True, env=env)
        check("a refusal exits 1 with the reason in the JSON",
              run.returncode == 1 and not json.loads(run.stdout or "{}").get("ok", True), run.stdout[:200])
        run = subprocess.run([sys.executable, move_path, "kr"], capture_output=True, text=True,
                             env=dict(env, CLX_MOVE_CLX="/nonexistent/clx"))
        check("a clx that cannot be loaded exits 2 and moves nothing",
              run.returncode == 2 and box.link_target(mine) == ".claude-yk", "%s %r" % (run.returncode, run.stdout[:200]))
        run = subprocess.run([sys.executable, move_path], capture_output=True, text=True, env=env)
        check("no account named: usage, exit 2", run.returncode == 2, str(run.returncode))


def main():
    global VERBOSE, MOVE
    ap = argparse.ArgumentParser()
    ap.add_argument("--clx", default=dead.DEFAULT_CLX)
    ap.add_argument("--move", default=os.path.join(HERE, "..", "clx-move"))
    ap.add_argument("-v", action="store_true")
    args = ap.parse_args()
    VERBOSE = args.v
    MOVE = load("clx_move", args.move)
    for case in (t_moves_all, t_names, t_refuses_spent, t_refuses_unusable, t_no_sessions, t_dry_run, t_busy):
        case(args.clx)
    t_cli(args.clx, args.move)
    print("%d passed, %d failed  (clx: %s)" % (PASS, FAIL, args.clx))
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
