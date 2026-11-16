#!/usr/bin/env python3
"""Sandbox assertions: a DEAD login is never a launch choice or a hand-off target.

Defect (2026-10-02): One account's OAuth grant hit its absolute refreshTokenExpiresAt
(30 days after its cm-login). The next Claude Code request could not refresh and
blanked both tokens in ~/.claude-carol/.credentials.json. clx kept reading the
usage CACHE, which still said "5h 1%, 7d 68%" (status no-token), so:
  * the watcher handed a session on Bob (5h 90%) -> Carol as a stale
    "last resort" - straight onto a dead login ("Login expired · Please run /login");
  * every launch picked Carol as "primary under threshold";
  * a session already on the dead account was never moved off it.

Everything here runs in a throw-away HOME with FAKE tokens. No network: the
/usage fetch, the detached refresh and the desktop notice are stubbed, and the
final exec into claude is intercepted. Nothing outside the sandbox is touched.

Usage:  python3 test/test-dead-auth.py [--clx PATH] [-v]
Exit 0 when every assertion passes.
"""
import argparse
import contextlib
import importlib.machinery
import importlib.util
import io
import json
import os
import shutil
import sys
import tempfile
import time

DEFAULT_CLX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "clx")
PASS = FAIL = 0
VERBOSE = False
NOW = time.time()
H = 3600 * 1000  # one hour in ms, the unit credentials files use


def check(name, ok, detail=""):
    global PASS, FAIL
    if ok:
        PASS += 1
        if VERBOSE:
            print("PASS  %s" % name)
    else:
        FAIL += 1
        print("FAIL  %s  %s" % (name, detail))


# ------------------------------------------------------------------ sandbox


class Launch(Exception):
    """Raised instead of os.execve so main() returns to the test."""

    def __init__(self, argv, env):
        Exception.__init__(self, "exec")
        self.argv, self.env = argv, env


def creds(kind):
    """Fake credentials. Token strings are placeholders, never real ones."""
    now_ms = NOW * 1000
    if kind == "alive":
        return {"accessToken": "fake-at", "refreshToken": "fake-rt",
                "expiresAt": now_ms + 8 * H, "refreshTokenExpiresAt": now_ms + 20 * 24 * H}
    if kind == "blank":       # what Claude Code leaves after a refresh it could not do
        return {"accessToken": "", "refreshToken": "", "expiresAt": 0,
                "refreshTokenExpiresAt": now_ms - 3 * H}
    if kind == "expired":     # access AND refresh token past expiry
        return {"accessToken": "fake-at", "refreshToken": "fake-rt",
                "expiresAt": now_ms - 50 * H, "refreshTokenExpiresAt": now_ms - 57 * H}
    if kind == "refreshable":  # access expired, refresh token still good
        return {"accessToken": "fake-at", "refreshToken": "fake-rt",
                "expiresAt": now_ms - 1 * H, "refreshTokenExpiresAt": now_ms + 20 * 24 * H}
    if kind == "refresh-dying":  # refresh expired but the access token still works
        return {"accessToken": "fake-at", "refreshToken": "fake-rt",
                "expiresAt": now_ms + 2 * H, "refreshTokenExpiresAt": now_ms - 1 * H}
    raise ValueError(kind)


class Box(object):
    """One sandbox HOME plus a freshly loaded clx module bound to it."""

    def __init__(self, clx_path):
        self.root = tempfile.mkdtemp(prefix="clx-dead-auth-")
        self.home = self.root
        os.makedirs(os.path.join(self.home, ".claude"))
        self.saved_env = dict(os.environ)
        os.environ["HOME"] = self.home
        os.environ["CLX_NO_WATCH"] = "1"
        os.environ["CLX_NO_NOTIFY"] = "1"
        os.environ["CC_CLAUDE_BIN"] = "/bin/true"
        for key in ("CLAUDE_CONFIG_DIR", "CLX_INSIDE", "CC_THRESHOLD", "CC_PRIMARY",
                    "CC_CACHE_TTL", "CC_STALE_TTL", "ANTHROPIC_MODEL", "CC_HANDOFF_MIN_GAP"):
            os.environ.pop(key, None)
        loader = importlib.machinery.SourceFileLoader("clx_under_test", clx_path)
        spec = importlib.util.spec_from_loader("clx_under_test", loader)
        self.mod = importlib.util.module_from_spec(spec)
        loader.exec_module(self.mod)
        self.fetched = []
        self.spawned = []
        self.notes = []
        self.fetch_answer = {}
        box = self

        def fake_fetch(directory):
            name = os.path.basename(directory)
            name = name[len(".claude-"):] if name.startswith(".claude-") else name
            box.fetched.append(name)
            return box.fetch_answer.get(name, (None, "429"))

        self.mod.fetch_usage = fake_fetch
        self.mod.spawn_refresh = lambda *ids: box.spawned.append(ids)
        self.mod.notify = lambda summary, body="", urgency="normal": box.notes.append(
            (summary, body, urgency)) or True
        self.mod.session_model = lambda payload=None: None
        self.write_json(os.path.join(self.home, ".claude", "cc.json"),
                        {"threshold": 90, "primary": "mk"})
        self.cache = {}

    def close(self):
        os.environ.clear()
        os.environ.update(self.saved_env)
        shutil.rmtree(self.root, ignore_errors=True)

    @staticmethod
    def write_json(path, obj):
        with open(path, "w") as fh:
            json.dump(obj, fh)

    def account(self, aid, kind, five=None, seven=None, age=60, status="ok",
                checked_age=None, email=None):
        d = os.path.join(self.home, ".claude-" + aid)
        os.makedirs(d, exist_ok=True)
        self.write_json(os.path.join(d, ".credentials.json"), {"claudeAiOauth": creds(kind)})
        self.write_json(os.path.join(d, ".claude.json"),
                        {"oauthAccount": {"emailAddress": email or "%s@example.test" % aid}})
        if five is not None:
            fetched = int(NOW - age)
            entry = {"five_hour": five, "seven_day": seven, "resets_at": None,
                     "windows": {"five_hour": {"utilization": five, "resets_at": None, "label": "5h"},
                                 "seven_day": {"utilization": seven, "resets_at": None, "label": "7d"}},
                     "fetchedAt": fetched, "status": status,
                     "checkedAt": int(NOW - (0 if checked_age is None else checked_age)),
                     "email": email or "%s@example.test" % aid, "dir": d}
            self.cache[aid] = entry
            self.flush_cache()
        return d

    def flush_cache(self):
        self.write_json(self.mod.CACHE_FILE, self.cache)

    def conf(self, **kw):
        base = {"threshold": 90, "primary": "mk"}
        base.update(kw)
        self.write_json(self.mod.CONF_FILE, base)

    def accounts(self):
        m = self.mod
        conf = m.load_conf()
        accts, _ = m.dedupe(m.discover(), conf["primary"].strip().lower())
        m.refresh(accts, force=False, only="__none__")
        m.apply_model(accts, None)
        m.apply_pauses(accts, conf)
        return conf, accts

    def by_id(self, accts, aid):
        return next(a for a in accts if a.id == aid)

    def session_on(self, aid, **meta_extra):
        """A live-looking session dir whose credentials link points into `aid`."""
        m = self.mod
        path = os.path.join(m.SESSIONS_ROOT, str(os.getpid()))
        os.makedirs(path, exist_ok=True)
        acct_dir = os.path.join(self.home, ".claude-" + aid)
        m.point_credentials(path, acct_dir)
        shutil.copy(os.path.join(acct_dir, ".claude.json"), os.path.join(path, ".claude.json"))
        meta = {"pid": os.getpid(), "started_at": int(NOW) - 3600, "account_id": aid,
                "account_dir": acct_dir, "account_name": aid.title(), "threshold": 90.0,
                "handoffs": [], "last_handoff_at": 0}
        meta.update(meta_extra)
        m.write_session_meta(path, meta)
        return path

    def hook(self, session_dir, event="prompt"):
        """The real hook entry point, run inside `session_dir`. -> stdout text."""
        os.environ["CLAUDE_CONFIG_DIR"] = session_dir
        out = io.StringIO()
        old_in = sys.stdin
        sys.stdin = io.StringIO("")
        try:
            with contextlib.redirect_stdout(out):
                self.mod.cmd_handoff_check(event)
        finally:
            sys.stdin = old_in
            os.environ.pop("CLAUDE_CONFIG_DIR", None)
        return out.getvalue()

    def link_target(self, session_dir):
        return os.path.basename(os.path.dirname(
            os.readlink(os.path.join(session_dir, ".credentials.json"))))

    def meta(self, session_dir):
        return self.mod.read_session_meta(session_dir) or {}

    def run_main(self, argv):
        """main() up to the exec. -> (rc or None, Launch or None, stdout, stderr)."""
        out, err = io.StringIO(), io.StringIO()
        real = os.execve

        def fake_execve(binary, args, env):
            raise Launch(args, env)

        os.execve = fake_execve
        launched = rc = None
        try:
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                rc = self.mod.main(argv)
        except Launch as exc:
            launched = exc
        finally:
            os.execve = real
        return rc, launched, out.getvalue(), err.getvalue()

    def active_id(self):
        try:
            with open(self.mod.ACTIVE_FILE) as fh:
                return json.load(fh).get("id")
        except Exception:
            return None

    def log(self):
        try:
            with open(self.mod.HANDOFF_LOG) as fh:
                return fh.read()
        except OSError:
            return ""


@contextlib.contextmanager
def sandbox(clx_path):
    box = Box(clx_path)
    try:
        yield box
    finally:
        box.close()


# ------------------------------------------------------------------- the cases


def incident(box):
    """The exact 2026-10-02 19:59 state, with fake tokens."""
    box.account("yk", "alive", five=90, seven=70, age=30)                      # spent
    box.account("mk", "blank", five=1, seven=68, age=5 * 3600, status="no-token")  # blanked by a failed refresh
    box.account("cw", "expired", five=100, seven=52, age=53 * 3600, status="429")  # hard-expired login


def t_candidates(clx):
    with sandbox(clx) as box:
        incident(box)
        conf, accts = box.accounts()
        yk = box.by_id(accts, "yk")
        nxt = box.mod.best_candidate(accts, {yk.id}, 90, allow_stale=True)
        check("incident: the stale last resort is never a logged-out account",
              nxt is None or nxt.id != "mk", "got %s" % (nxt and nxt.id))
        check("incident: nothing alive has room -> no candidate at all",
              nxt is None, "got %s" % (nxt and nxt.id))

    with sandbox(clx) as box:
        box.account("mk", "blank", five=1, seven=5, age=30, status="no-token")
        box.account("bt", "alive", five=50, seven=50, age=30)
        box.account("yk", "alive", five=95, seven=60, age=30)
        conf, accts = box.accounts()
        nxt = box.mod.best_candidate(accts, {"yk"}, 90)
        check("fresh numbers: a logged-out account with the most head-room is skipped",
              nxt is not None and nxt.id == "bt", "got %s" % (nxt and nxt.id))

    with sandbox(clx) as box:
        box.account("cw", "expired")          # no cache entry: usage unknown
        box.account("yk", "alive", five=95, seven=60, age=30)
        conf, accts = box.accounts()
        nxt = box.mod.best_candidate(accts, {"yk"}, 90)
        check("unknown usage: an expired-unrefreshable login is not the 'unknown' last resort",
              nxt is None, "got %s" % (nxt and nxt.id))

    with sandbox(clx) as box:
        box.account("rf", "refreshable", five=10, seven=10, age=30, status="http-401")
        box.account("yk", "alive", five=95, seven=60, age=30)
        conf, accts = box.accounts()
        nxt = box.mod.best_candidate(accts, {"yk"}, 90)
        check("no false failure: an expired access token with a good refresh token stays a "
              "candidate (Claude Code refreshes it), even after a 401",
              nxt is not None and nxt.id == "rf", "got %s" % (nxt and nxt.id))

    with sandbox(clx) as box:
        box.account("rd", "refresh-dying", five=10, seven=10, age=30)
        box.account("yk", "alive", five=95, seven=60, age=30)
        conf, accts = box.accounts()
        nxt = box.mod.best_candidate(accts, {"yk"}, 90)
        check("no false failure: a valid access token whose refresh token expired still works",
              nxt is not None and nxt.id == "rd", "got %s" % (nxt and nxt.id))

    with sandbox(clx) as box:
        d = box.account("rv", "alive", five=10, seven=10, age=30, status="http-401")
        mtime = os.stat(os.path.join(d, ".credentials.json")).st_mtime
        box.cache["rv"]["credsMtime"] = mtime
        box.flush_cache()
        box.account("yk", "alive", five=95, seven=60, age=30)
        conf, accts = box.accounts()
        nxt = box.mod.best_candidate(accts, {"yk"}, 90)
        check("auth-failing: /usage 401 on an unexpired token of THIS file -> not a candidate",
              nxt is None, "got %s" % (nxt and nxt.id))
        time.sleep(0.02)
        box.write_json(os.path.join(d, ".credentials.json"), {"claudeAiOauth": creds("alive")})
        conf, accts = box.accounts()
        nxt = box.mod.best_candidate(accts, {"yk"}, 90)
        check("auth-failing heals: a re-login (new file) clears the 401 verdict at once",
              nxt is not None and nxt.id == "rv", "got %s" % (nxt and nxt.id))

    with sandbox(clx) as box:
        d = box.account("bad", "alive", five=10, seven=10, age=30)
        with open(os.path.join(d, ".credentials.json"), "w") as fh:
            fh.write("{not json")
        box.account("yk", "alive", five=95, seven=60, age=30)
        conf, accts = box.accounts()
        nxt = box.mod.best_candidate(accts, {"yk"}, 90)
        check("no false failure: an unreadable credentials file is not evidence of a dead login",
              nxt is not None and nxt.id == "bad", "got %s" % (nxt and nxt.id))


def t_select(clx):
    with sandbox(clx) as box:
        box.account("mk", "blank", five=1, seven=68, age=30, status="no-token")
        box.account("yk", "alive", five=20, seven=40, age=30)
        conf, accts = box.accounts()
        chosen, nxt, reason, notes = box.mod.select(accts, conf)
        check("launch: a logged-out PRIMARY under threshold is not launched on",
              chosen.id == "yk", "chose %s (%s)" % (chosen.id, reason))
        check("launch: the 'next' account is never a dead login",
              nxt is None or nxt.id != "mk", "next %s" % (nxt and nxt.id))
        check("launch banner tells the owner how to fix it (cm-login mk)",
              any("cm-login mk" in n for n in notes), notes)

    with sandbox(clx) as box:
        box.account("mk", "blank", five=1, seven=68, age=30, status="no-token")
        box.account("yk", "alive", five=95, seven=40, age=30)
        conf, accts = box.accounts()
        chosen, nxt, reason, notes = box.mod.select(accts, conf)
        check("launch: dead primary + every live account over threshold -> a LIVE account",
              chosen.id == "yk", "chose %s (%s)" % (chosen.id, reason))

    with sandbox(clx) as box:
        box.conf(primary="nobody")
        box.account("cw", "expired", five=0, seven=0, age=30, status="429")
        box.account("yk", "alive", five=95, seven=40, age=30)
        conf, accts = box.accounts()
        chosen, nxt, reason, notes = box.mod.select(accts, conf)
        check("launch: missing primary -> the fallback is a live account, not accounts[0]",
              chosen.id == "yk", "chose %s (%s)" % (chosen.id, reason))

    with sandbox(clx) as box:
        box.account("mk", "blank", five=1, seven=68, age=30, status="no-token")
        box.account("yk", "alive", five=20, seven=40, age=30)
        rc, launched, out, err = box.run_main([])
        check("main(): a plain launch lands on the live account",
              launched is not None and box.active_id() == "yk",
              "rc=%s active=%s err=%s" % (rc, box.active_id(), err.strip()[:200]))
        if launched is not None:
            sess = launched.env.get("CLAUDE_CONFIG_DIR") or ""
            target = os.path.realpath(os.path.join(sess, ".credentials.json"))
            check("main(): the new session's credentials link points into the live account",
                  os.path.basename(os.path.dirname(target)) == ".claude-yk", target)

    with sandbox(clx) as box:
        box.account("mk", "blank", five=1, seven=68, age=30, status="no-token")
        box.account("yk", "alive", five=20, seven=40, age=30)
        rc, launched, out, err = box.run_main(["--use", "mk"])
        check("--use on a dead login refuses (exit 2) instead of launching into 'Login expired'",
              launched is None and rc == 2, "rc=%s launched=%s" % (rc, launched is not None))
        check("--use refusal names the fix", "cm-login mk" in err, err.strip()[:200])


def t_session(clx):
    # The 19:59:57 hand-off itself, through the real hook entry point.
    with sandbox(clx) as box:
        incident(box)
        sess = box.session_on("yk")
        box.hook(sess, "stop")
        check("incident: a spent session is NOT handed to the logged-out account",
              box.link_target(sess) == ".claude-yk", box.link_target(sess))
        check("incident: no hand-off recorded", not box.meta(sess).get("handoffs"),
              box.meta(sess).get("handoffs"))

    # A session sitting on a dead login moves off it, whatever its usage says.
    with sandbox(clx) as box:
        box.account("mk", "blank", five=1, seven=68, age=30, status="no-token")
        box.account("yk", "alive", five=20, seven=40, age=30)
        sess = box.session_on("mk")
        out = box.hook(sess, "prompt")
        check("a live session on a logged-out account moves to a live one",
              box.link_target(sess) == ".claude-yk", box.link_target(sess))
        hand = (box.meta(sess).get("handoffs") or [{}])[-1]
        check("the move is recorded with the auth trigger",
              hand.get("to") == "Yk" and (hand.get("trigger") or {}).get("window") == "auth", hand)
        check("the move is logged", "Mk (" in box.log() and "-> Yk" in box.log(), box.log()[-300:])
        check("the desktop is told (notify-send) and told not to /login",
              box.notes and "/login" in (box.notes[-1][1] or ""), box.notes)
        check("the model is told the session moved", "moved from" in out, out)

    # ...even right after another hand-off (the loop guard is for usage, not for a dead login).
    with sandbox(clx) as box:
        box.account("mk", "blank", five=1, seven=68, age=30, status="no-token")
        box.account("yk", "alive", five=20, seven=40, age=30)
        sess = box.session_on("mk", last_handoff_at=int(time.time()) - 5)
        box.hook(sess, "stop")
        check("a dead login is left at once, even inside HANDOFF_MIN_GAP",
              box.link_target(sess) == ".claude-yk", box.link_target(sess))

    # Through the watcher's timer path too (no hook event at all).
    with sandbox(clx) as box:
        box.account("cw", "expired", five=5, seven=5, age=30, status="429")
        box.account("yk", "alive", five=20, seven=40, age=30)
        sess = box.session_on("cw")
        outcome = box.mod.watch_decide_once(sess)
        check("watcher tick moves a session off an expired-unrefreshable login",
              box.link_target(sess) == ".claude-yk", "%s %s" % (outcome, box.link_target(sess)))
        check("watcher move notifies as critical",
              box.notes and box.notes[-1][2] == "critical", box.notes)

    # Dead with nowhere to go: stay, say so once, never pretend it is a usage problem.
    with sandbox(clx) as box:
        box.account("mk", "blank", five=1, seven=68, age=30, status="no-token")
        box.account("cw", "expired", five=5, seven=5, age=30, status="429")
        sess = box.session_on("mk")
        out = box.hook(sess, "prompt")
        check("dead with nowhere to go: stays put (no move onto another dead login)",
              box.link_target(sess) == ".claude-mk", box.link_target(sess))
        check("dead with nowhere to go: the prompt is told how to fix it",
              "cm-login mk" in out, out)
        out2 = box.hook(sess, "prompt")
        check("dead with nowhere to go: said once, not on every prompt",
              "cm-login" not in out2, out2)

    # In-session re-login to the SAME account must not be undone by a move.
    with sandbox(clx) as box:
        box.account("mk", "blank", five=1, seven=10, age=30, status="no-token")
        box.account("yk", "alive", five=20, seven=40, age=30)
        sess = box.session_on("mk")
        link = os.path.join(sess, ".credentials.json")
        os.unlink(link)
        box.write_json(link, {"claudeAiOauth": creds("alive")})  # /login renamed a file over it
        box.hook(sess, "stop")
        check("in-session re-login of the same account: tokens adopted, session NOT moved off",
              box.link_target(sess) == ".claude-mk", box.link_target(sess))
        conf, accts = box.accounts()
        check("...and the account is alive again",
              box.mod.best_candidate(accts, {"yk"}, 90) is not None)


def t_polling_and_status(clx):
    with sandbox(clx) as box:
        box.account("mk", "blank", five=1, seven=68, age=5 * 3600, status="no-token",
                    checked_age=3600)
        box.account("yk", "alive", five=20, seven=40, age=30)
        box.fetch_answer["mk"] = (None, "no-token")
        conf, accts = box.accounts()
        box.mod.refresh(accts, force=False)
        check("a dead login is still polled (so it heals once re-logged)", "mk" in box.fetched,
              box.fetched)
        cache = json.load(open(box.mod.CACHE_FILE))
        check("the cache entry carries the auth verdict for other readers",
              cache.get("mk", {}).get("auth") in ("logged out", "login expired"),
              cache.get("mk", {}).get("auth"))
        check("a live account's entry says auth null",
              "auth" not in cache.get("yk", {}) or cache["yk"]["auth"] is None, cache.get("yk"))

    with sandbox(clx) as box:
        box.account("mk", "blank", five=1, seven=68, age=30, status="no-token")
        box.account("cw", "expired", five=100, seven=52, age=53 * 3600, status="429")
        box.account("yk", "alive", five=20, seven=40, age=30)
        rc, launched, out, err = box.run_main(["--status"])
        row = next((l for l in out.splitlines() if l.lstrip(" *P").startswith("Mk ")), "")
        check("--status marks the dead login in its row", "logged out" in row, row)
        row = next((l for l in out.splitlines() if l.lstrip(" *P").startswith("Cw ")), "")
        check("--status marks the expired-unrefreshable login (not just '429')",
              "login expired" in row, row)
        check("--status prints the exact fix", "cm-login mk mk@example.test" in out, out[-600:])
        check("--status would not launch on the dead primary", "would launch: Yk" in out,
              [l for l in out.splitlines() if "would launch" in l])

    with sandbox(clx) as box:
        box.account("mk", "blank", five=1, seven=68, age=30, status="no-token")
        box.account("yk", "alive", five=20, seven=40, age=30)
        box.write_json(os.path.join(box.home, ".claude-mk", ".credentials.json"),
                       {"claudeAiOauth": creds("alive")})  # cm-login mk
        conf, accts = box.accounts()
        chosen, nxt, reason, notes = box.mod.select(accts, conf)
        check("after cm-login the primary is launched on again", chosen.id == "mk",
              "chose %s (%s)" % (chosen.id, reason))


# ------------------------------------------------- parity: no dead login, no change
# With every login alive the fix must change NOTHING. The pre-fix unit suites
# were never kept on disk, so this differential run is the regression net: the
# same random scenarios through the old and the new clx, every decision compared.


def scenario(rng):
    n = rng.randint(2, 4)
    ids = rng.sample(["aa", "bb", "cc", "dd", "ee"], n)
    accts = []
    for aid in ids:
        has = rng.random() < 0.85
        accts.append({
            "id": aid,
            "kind": rng.choice(["alive", "alive", "refreshable", "refresh-dying"]),
            "five": rng.choice([0, 5, 40, 85, 89, 90, 95, 100]) if has else None,
            "seven": rng.choice([0, 30, 70, 89, 92, 100]) if has else None,
            "age": rng.choice([10, 60, 300, 3 * 3600, 30 * 3600]),
            "status": rng.choice(["ok", "ok", "429", "http-401", "no-token"]),
        })
    paused = rng.choice([None, None, rng.choice(ids)])
    return {"accts": accts, "primary": rng.choice(ids + ["nobody"]), "paused": paused,
            "on": rng.choice(ids), "gap": rng.choice([0, int(NOW) - 5])}


def decisions(clx, sc):
    out = {}
    with sandbox(clx) as box:
        for a in sc["accts"]:
            box.account(a["id"], a["kind"], five=a["five"], seven=a["seven"], age=a["age"],
                        status=a["status"])
        conf = {"threshold": 90, "primary": sc["primary"]}
        if sc["paused"]:
            conf["paused"] = {sc["paused"]: {"until": None, "since": int(NOW), "reason": "t"}}
        box.conf(**conf)
        conf, accts = box.accounts()
        chosen, nxt, reason, notes = box.mod.select(accts, conf)
        out["select"] = (chosen.id, nxt and nxt.id, reason, sorted(notes))
        for a in accts:
            for stale in (False, True):
                got = box.mod.best_candidate(accts, {a.id}, 90, allow_stale=stale)
                out["best:%s:%s" % (a.id, stale)] = got and got.id
        sess = box.session_on(sc["on"], last_handoff_at=sc["gap"])
        text = box.hook(sess, "prompt").replace(box.home, "~")
        out["hook"] = (box.link_target(sess), len(box.meta(sess).get("handoffs") or []), text)
        box.mod.watch_decide_once(sess)
        out["watch"] = (box.link_target(sess), len(box.meta(sess).get("handoffs") or []))
        rc, launched, sout, serr = box.run_main(["--status"])
        out["status"] = [l for l in sout.replace(box.home, "~").splitlines()
                         if "would launch" in l or l.startswith("stale")]
    return out


def parity(old, new, rounds, seed):
    import random
    rng = random.Random(seed)
    for i in range(rounds):
        sc = scenario(rng)
        a, b = decisions(old, sc), decisions(new, sc)
        for key in sorted(set(a) | set(b)):
            check("parity #%d %s" % (i, key), a.get(key) == b.get(key),
                  "\n   scenario %s\n   old %r\n   new %r" % (sc, a.get(key), b.get(key)))


def main():
    global VERBOSE
    ap = argparse.ArgumentParser()
    ap.add_argument("--clx", default=DEFAULT_CLX)
    ap.add_argument("--parity", metavar="OLD_CLX",
                    help="also compare every decision with this pre-fix copy, all logins alive")
    ap.add_argument("--rounds", type=int, default=120)
    ap.add_argument("--seed", type=int, default=20261002)
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()
    VERBOSE = args.verbose
    for case in (t_candidates, t_select, t_session, t_polling_and_status):
        try:
            case(args.clx)
        except Exception as exc:
            import traceback
            check("%s raised" % case.__name__, False,
                  "%s: %s\n%s" % (type(exc).__name__, exc, traceback.format_exc()[-800:]))
    print("dead-auth: %d passed, %d failed  (%s)" % (PASS, FAIL, args.clx))
    if args.parity:
        before = (PASS, FAIL)
        try:
            parity(args.parity, args.clx, args.rounds, args.seed)
        except Exception as exc:
            import traceback
            check("parity raised", False, "%s\n%s" % (exc, traceback.format_exc()[-800:]))
        print("parity (%d scenarios vs %s): %d passed, %d failed"
              % (args.rounds, args.parity, PASS - before[0], FAIL - before[1]))
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
