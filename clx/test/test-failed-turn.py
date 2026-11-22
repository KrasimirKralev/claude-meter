#!/usr/bin/env python3
"""Sandbox assertions: the heal watcher acts on a FAILED request it reads in the transcript.

Defect: the OpenClaw gateway launches every Claude CLI session with
--settings {"disableAllHooks":true}, so no hook ever fires there. A turn that ended
"You've hit your weekly limit" or "OAuth token revoked" told clx nothing, and the
session stayed on that account until a /usage number agreed. Such a session is driven
over pipes (--input-format stream-json), so before this it got no session dir at all.

Everything runs in a throw-away HOME with FAKE tokens and no network - the sandbox is
test-dead-auth.py's Box, loaded from the file next to this one.

Usage:  python3 test/test-failed-turn.py [--clx PATH] [-v]
Exit 0 when every assertion passes.
"""
import argparse
import importlib.machinery
import importlib.util
import io
import json
import os
import re
import shutil
import sys
import threading
import time
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
_loader = importlib.machinery.SourceFileLoader("dead_auth", os.path.join(HERE, "test-dead-auth.py"))
_spec = importlib.util.spec_from_loader("dead_auth", _loader)
dead = importlib.util.module_from_spec(_spec)
_loader.exec_module(dead)

sandbox = dead.sandbox
PASS = FAIL = 0
VERBOSE = False

SID = "30989698-aaaa-4bbb-8ccc-0123456789ab"
CWD = "/srv/openclaw/workspace"
WEEKLY = "You've hit your weekly limit · resets 7am (UTC)"
SESSION = "You've hit your session limit · resets 3pm (UTC)"
FABLE = ("You've reached your Fable limit. Switch to another model, or manage usage credits "
         "at https://claude.ai/settings/usage")
REVOKED = ("Failed to authenticate: OAuth token revoked. Please log in again or contact "
           "your administrator.")
OVERLOADED = ("API Error: 529 Overloaded. This is a server-side issue, usually temporary "
              "— try again in a moment.")
FD_TOKEN = "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR"
# What the gateway's Claude CLI backend passes (no tty: stdin and stdout are pipes).
GATEWAY_ARGV = ["-p", "--input-format", "stream-json", "--output-format", "stream-json",
                "--verbose", "--settings", '{"disableAllHooks":true}']


def check(name, ok, detail=""):
    global PASS, FAIL
    if ok:
        PASS += 1
        if VERBOSE:
            print("PASS  %s" % name)
    else:
        FAIL += 1
        print("FAIL  %s  %s" % (name, detail))


def iso(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def api_error(at, text, error="rate_limit", status=429, **extra):
    """One failed request, shaped as Claude Code 2.1.x writes it."""
    line = {"parentUuid": "p", "isSidechain": False, "type": "assistant", "uuid": "u-%f" % at,
            "timestamp": iso(at), "sessionId": SID, "cwd": CWD, "version": "2.1.321",
            "message": {"id": "m", "model": "<synthetic>", "role": "assistant", "type": "message",
                        "content": [{"type": "text", "text": text}]},
            "error": error, "apiErrorStatus": status, "isApiErrorMessage": True}
    line.update(extra)
    return json.dumps(line)


def answer(at, text="PONG", model="claude-opus-5-5"):
    return json.dumps({"type": "assistant", "timestamp": iso(at), "sessionId": SID,
                       "message": {"model": model, "role": "assistant",
                                   "content": [{"type": "text", "text": text}]}})


def prompt(at, text):
    return json.dumps({"type": "user", "timestamp": iso(at), "sessionId": SID,
                       "message": {"role": "user", "content": text}})


def write_lines(path, lines, mode="w"):
    with open(path, mode) as fh:
        fh.write("".join(line + "\n" for line in lines))


def gateway_session(box, aid, lines, registry="full", **meta):
    """A session as the gateway launches it: hooks off, so NO transcript_path in its meta."""
    sess = box.session_on(aid, **meta)
    pid = os.path.basename(sess)
    if registry != "none":
        os.makedirs(os.path.join(sess, "sessions"), exist_ok=True)
        entry = {"pid": int(pid), "sessionId": SID}
        if registry == "full":
            entry["cwd"] = CWD
        box.write_json(os.path.join(sess, "sessions", pid + ".json"), entry)
    folder = os.path.join(sess, "projects", re.sub(r"[^A-Za-z0-9]", "-", CWD))
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, SID + ".jsonl")
    write_lines(path, lines)
    return sess, path


def cache_of(box):
    with open(box.mod.CACHE_FILE) as fh:
        return json.load(fh)


def two_accounts(box, other_five=5):
    box.account("mk", "alive", five=10, seven=20, age=30)   # the session's account: numbers look fine
    box.account("ct", "alive", five=other_five, seven=10, age=30)


class Pipe(io.StringIO):
    """stdin/stdout as the gateway gives them: not a terminal."""

    def isatty(self):
        return False


# ------------------------------------------------------------------- the cases


def t_scan(clx):
    with sandbox(clx) as box:
        m = box.mod
        t = time.time()
        path = os.path.join(box.home, "t.jsonl")
        write_lines(path, [
            prompt(t - 60, "why did it say: " + WEEKLY),
            answer(t - 59, "It said: " + WEEKLY),
            json.dumps({"type": "user", "isApiErrorMessage": True, "timestamp": iso(t - 58),
                        "message": {"role": "user", "content": WEEKLY}}),
            api_error(t - 50, WEEKLY),
            api_error(t - 40, OVERLOADED, error="server_error", status=529),
            api_error(t - 30, REVOKED, error="authentication_failed", status=401),
            api_error(t - 20, FABLE),
            api_error(t - 10, "API Error: Rate limit reached", error="rate_limit", status=429),
        ])
        pos, events = m.scan_failed_turns(path)
        check("scan: only real failed requests that name the account are returned",
              [e[1] for e in events] == ["limit", "auth", "limit"], [e[1:3] for e in events])
        check("scan: the position is the end of the file", pos == os.path.getsize(path), pos)
        check("scan: the time of the line is kept to the millisecond",
              events and abs(events[0][0] - (t - 50)) < 0.002, events[:1])
        again, events = m.scan_failed_turns(path, pos)
        check("scan: nothing new, nothing returned", again == pos and events == [], (again, events))
        with open(path, "a") as fh:
            fh.write(api_error(t - 5, SESSION)[:80])
        mid, events = m.scan_failed_turns(path, pos)
        check("scan: a line still being written is left for the next look",
              mid == pos and events == [], (mid, events))
        with open(path, "a") as fh:
            fh.write(api_error(t - 5, SESSION)[80:] + "\n")
        end, events = m.scan_failed_turns(path, pos)
        check("scan: ...and read once it is whole",
              [e[1] for e in events] == ["limit"] and end == os.path.getsize(path), events)
        # A first look only goes back FAILSCAN_BYTES.
        big = os.path.join(box.home, "big.jsonl")
        filler = answer(t - 400, "x" * 2000)
        write_lines(big, [api_error(t - 500, WEEKLY)] + [filler] * 200 + [api_error(t - 3, WEEKLY)])
        pos, events = m.scan_failed_turns(big)
        check("scan: a first look reads only the tail of a long transcript",
              len(events) == 1 and abs(events[0][0] - (t - 3)) < 0.002, events)
        check("scan: a missing file is no error", m.scan_failed_turns(big + ".nope") == (None, []))

        check("the Fable message counts as a usage limit", bool(m.LIMIT_TEXT.search(FABLE)))
        check("an overload does not", not m.LIMIT_TEXT.search(OVERLOADED))
        check("a plain API rate limit does not", not m.LIMIT_TEXT.search("API Error: Rate limit reached"))
        check("window: weekly", m.limit_window_of(WEEKLY) == "seven_day", m.limit_window_of(WEEKLY))
        check("window: session", m.limit_window_of(SESSION) == "five_hour", m.limit_window_of(SESSION))
        check("window: a model's own cap", m.limit_window_of(FABLE) == "weekly_fable",
              m.limit_window_of(FABLE))
        check("window: no word, no model", m.limit_window_of("You've hit your limit") == "five_hour")
        check("timestamp: Z suffix", m.transcript_epoch("2026-01-15T08:30:00.123Z") == 1768465800.123,
              m.transcript_epoch("2026-01-15T08:30:00.123Z"))
        check("timestamp: rubbish", m.transcript_epoch("soon") is None and m.transcript_epoch(None) is None)


def t_limit(clx):
    # The defect itself: hooks off, numbers fine, the request fails on a weekly limit.
    with sandbox(clx) as box:
        two_accounts(box)
        t = time.time()
        sess, path = gateway_session(box, "mk", [prompt(t - 5, "hi"), api_error(t - 2, WEEKLY)])
        check("no transcript path in the meta (hooks are off)", "transcript_path" not in box.meta(sess))
        state = {}
        out = box.mod.watch_failed_turns_once(sess, state)
        check("limit: the session is moved at once", out == "moved" and box.link_target(sess) == ".claude-ct",
              (out, box.link_target(sess)))
        hit = (cache_of(box).get("mk") or {}).get("limitHit") or {}
        check("limit: the evidence is recorded against the account it failed on",
              hit.get("window") == "seven_day" and abs(hit.get("at", 0) - (t - 2)) <= 1, hit)
        hand = (box.meta(sess).get("handoffs") or [{}])[-1]
        check("limit: the move is the ordinary watcher hand-off, with its trigger",
              hand.get("event") == "watch" and hand.get("to") == "Ct"
              and (hand.get("trigger") or {}).get("window") == "seven_day", hand)
        check("limit: the failed turn and the move are both in the log",
              "failed turn on Mk (limit)" in box.log() and "-> Ct" in box.log(), box.log()[-400:])
        check("limit: a second look does nothing",
              box.mod.watch_failed_turns_once(sess, state) == "unchanged")
        # The new account answers; a later look must not act on the old line again.
        write_lines(path, [answer(time.time())], mode="a")
        out = box.mod.watch_failed_turns_once(sess, {})
        check("limit: a fresh watcher does not act on the same line twice",
              out in ("stale", "clean") and box.link_target(sess) == ".claude-ct",
              (out, box.link_target(sess)))

    # Inside the loop guard: a hand-off 60 s ago does not make the session wait.
    with sandbox(clx) as box:
        two_accounts(box)
        t = time.time()
        sess, _ = gateway_session(box, "mk", [api_error(t - 2, WEEKLY)], last_handoff_at=int(t) - 60)
        out = box.mod.watch_failed_turns_once(sess, {})
        check("limit: moved even inside HANDOFF_MIN_GAP",
              out == "moved" and box.link_target(sess) == ".claude-ct", (out, box.link_target(sess)))

    # A model's own cap is recorded as that model's window.
    with sandbox(clx) as box:
        two_accounts(box)
        t = time.time()
        sess, _ = gateway_session(box, "mk", [api_error(t - 2, FABLE)])
        out = box.mod.watch_failed_turns_once(sess, {})
        hit = (cache_of(box).get("mk") or {}).get("limitHit") or {}
        check("limit: 'reached your Fable limit' moves the session and names weekly_fable",
              out == "moved" and hit.get("window") == "weekly_fable", (out, hit))

    # Nowhere to go: the evidence is kept, nothing is moved.
    with sandbox(clx) as box:
        two_accounts(box, other_five=97)
        t = time.time()
        sess, _ = gateway_session(box, "mk", [api_error(t - 2, WEEKLY)])
        out = box.mod.watch_failed_turns_once(sess, {})
        check("limit: with every other account spent the session stays, the evidence is kept",
              out == "recorded" and box.link_target(sess) == ".claude-mk"
              and "limitHit" in (cache_of(box).get("mk") or {}), (out, box.link_target(sess)))

    # The evidence expires: a newer good measurement wins over it.
    with sandbox(clx) as box:
        two_accounts(box, other_five=97)
        t = time.time()
        sess, _ = gateway_session(box, "mk", [api_error(t - 2, WEEKLY)])
        box.mod.watch_failed_turns_once(sess, {})
        box.cache = cache_of(box)
        box.cache["mk"]["fetchedAt"] = int(time.time()) + 1
        box.flush_cache()
        conf, accts = box.accounts()
        check("limit: a /usage answer measured after the failure replaces it",
              box.mod.over_threshold(box.by_id(accts, "mk"), 90) is None,
              box.mod.over_threshold(box.by_id(accts, "mk"), 90))


def t_ignored(clx):
    cases = [
        ("an old line of a resumed transcript (before this process started)",
         lambda t: [api_error(dead.NOW - 7200, WEEKLY)], {}),
        ("a failure that landed right after a hand-off (it belongs to the old account)",
         lambda t: [api_error(t - 2, WEEKLY)], {"last_handoff_at": int(time.time()) - 5}),
        ("a line an earlier tick already acted on",
         lambda t: [api_error(t - 2, WEEKLY)], {"failed_turn_at": time.time() - 1}),
        ("an overload", lambda t: [api_error(t - 2, OVERLOADED, error="server_error", status=529)], {}),
        ("a model quoting the message", lambda t: [answer(t - 2, WEEKLY)], {}),
    ]
    for name, lines, meta in cases:
        with sandbox(clx) as box:
            two_accounts(box)
            sess, _ = gateway_session(box, "mk", lines(time.time()), **meta)
            out = box.mod.watch_failed_turns_once(sess, {})
            check("ignored: %s" % name,
                  out in ("stale", "clean") and box.link_target(sess) == ".claude-mk"
                  and "limitHit" not in (cache_of(box).get("mk") or {}), (out, box.link_target(sess)))

    with sandbox(clx) as box:
        two_accounts(box)
        t = time.time()
        sess, _ = gateway_session(box, "mk", [api_error(t - 2, WEEKLY)])
        os.environ["CLX_NO_FAIL_SCAN"] = "1"
        try:
            out = box.mod.watch_failed_turns_once(sess, {})
        finally:
            os.environ.pop("CLX_NO_FAIL_SCAN", None)
        check("the kill switch turns it off", out == "off" and box.link_target(sess) == ".claude-mk", out)


def t_foreign_credentials(clx):
    """A session that authenticates with something else must never charge the account."""
    with sandbox(clx) as box:
        m = box.mod
        check("foreign: a forwarded pool token never counts (clx steps aside or drops it)",
              m.foreign_auth_env({FD_TOKEN: "7"}) == [], m.foreign_auth_env({FD_TOKEN: "7"}))
        check("foreign: an API key or a token in the environment counts",
              m.foreign_auth_env({"ANTHROPIC_API_KEY": "x", "CLAUDE_CODE_OAUTH_TOKEN": "y", "HOME": "/"})
              == ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"])
        check("foreign: an empty value does not", m.foreign_auth_env({"ANTHROPIC_API_KEY": ""}) == [])

    with sandbox(clx) as box:
        two_accounts(box)
        t = time.time()
        sess, _ = gateway_session(box, "mk", [api_error(t - 2, REVOKED, error="authentication_failed",
                                                        status=401), api_error(t - 1, WEEKLY)],
                                  foreign_auth=["ANTHROPIC_API_KEY"])
        state = {}
        out = box.mod.watch_failed_turns_once(sess, state)
        entry = cache_of(box).get("mk") or {}
        check("foreign: its failures are not charged to the account and nothing moves",
              out == "foreign-auth" and box.link_target(sess) == ".claude-mk"
              and "limitHit" not in entry and entry.get("status") == "ok", (out, entry.get("status")))
        check("foreign: ...and it is not looked at again",
              box.mod.watch_failed_turns_once(sess, state) == "foreign-auth" and state.get("off") is True)

    # The launch itself stamps the session.
    with sandbox(clx) as box:
        two_accounts(box)
        os.environ["ANTHROPIC_API_KEY"] = "fake-key"
        try:
            chosen = box.by_id(box.accounts()[1], "mk")
            sess = box.mod.create_session(chosen, 90)
        finally:
            os.environ.pop("ANTHROPIC_API_KEY", None)
        check("foreign: create_session records it in the session's own file",
              box.meta(sess).get("foreign_auth") == ["ANTHROPIC_API_KEY"], box.meta(sess).get("foreign_auth"))
        chosen = box.by_id(box.accounts()[1], "mk")
        sess = box.mod.create_session(chosen, 90)
        check("foreign: an ordinary launch carries no such mark", "foreign_auth" not in box.meta(sess),
              box.meta(sess).get("foreign_auth"))


def launch(box, argv, env=None):
    """main() as the gateway runs it: pipes, no tty. -> (rc, Launch or None, stderr)."""
    saved_in, saved_out = sys.stdin, sys.stdout
    added = dict(env or {})
    for key, value in added.items():
        os.environ[key] = value
    sys.stdin = Pipe("")
    try:
        rc, launched, _, err = box.run_main(argv)
    finally:
        sys.stdin, sys.stdout = saved_in, saved_out
        for key in added:
            os.environ.pop(key, None)
    return rc, launched, err


def t_gateway_launch(clx):
    """What the gateway's launch gets: a session dir, and clx's own choice of login."""
    with sandbox(clx) as box:
        two_accounts(box)
        m = box.mod
        check("a stream-json driver on pipes is a long-lived session",
              m.long_lived_stdio(GATEWAY_ARGV) and m.long_lived_stdio(["--input-format=stream-json"])
              and not m.long_lived_stdio(["-p", "hello", "--output-format", "stream-json"]))
        sys.stdin = Pipe("")
        try:
            check("wants_session: yes for the gateway's argv without a tty",
                  m.wants_session(GATEWAY_ARGV) is True)
            check("wants_session: still no for a one-shot -p on a pipe",
                  m.wants_session(["-p", "hello"]) is False)
            check("wants_session: still no for a subcommand",
                  m.wants_session(["mcp", "list", "--input-format", "stream-json"]) is False)
        finally:
            sys.stdin = sys.__stdin__

        rc, launched, err = launch(box, GATEWAY_ARGV)
        cfg = (launched.env.get("CLAUDE_CONFIG_DIR") or "") if launched else ""
        check("launch: the gateway's run gets its own session dir",
              launched is not None and cfg.startswith(m.SESSIONS_ROOT + os.sep), (rc, cfg, err[-300:]))
        check("launch: ...and the argv reaches the CLI unchanged",
              launched is not None and launched.argv[1:] == GATEWAY_ARGV, launched and launched.argv)

    # A token handed in on a file descriptor beats .credentials.json.
    with sandbox(clx) as box:
        two_accounts(box)
        rc, launched, err = launch(box, GATEWAY_ARGV, {FD_TOKEN: "7"})
        env = launched.env if launched else {}
        check("injected token: without CLX_DROP_INJECTED_TOKEN clx steps aside",
              launched is not None and env.get(FD_TOKEN) == "7" and "CLAUDE_CONFIG_DIR" not in env
              and not os.path.isdir(box.mod.SESSIONS_ROOT), (rc, sorted(env)[:3], err[-300:]))
        check("injected token: ...and says why", "CLX_DROP_INJECTED_TOKEN" in err, err[-300:])

    with sandbox(clx) as box:
        two_accounts(box)
        rc, launched, err = launch(box, GATEWAY_ARGV, {FD_TOKEN: "7", "CLX_DROP_INJECTED_TOKEN": "1"})
        env = launched.env if launched else {}
        check("injected token: with CLX_DROP_INJECTED_TOKEN=1 clx chooses and drops the variable",
              launched is not None and FD_TOKEN not in env
              and (env.get("CLAUDE_CONFIG_DIR") or "").startswith(box.mod.SESSIONS_ROOT + os.sep),
              (rc, err[-300:]))
        check("injected token: ...the launch line says the token was ignored",
              "ignoring the injected" in err, err[-300:])
        sess = env.get("CLAUDE_CONFIG_DIR") or ""
        check("injected token: a dropped token does not stamp the session as foreign",
              sess and "foreign_auth" not in box.meta(sess), sess and box.meta(sess))

    with sandbox(clx) as box:
        two_accounts(box)
        rc, launched, err = launch(box, ["--status"], {FD_TOKEN: "7"})
        check("injected token: clx's own commands still answer", rc == 0 and launched is None,
              (rc, err[-300:]))


def t_finding_the_transcript(clx):
    with sandbox(clx) as box:
        two_accounts(box)
        t = time.time()
        sess, path = gateway_session(box, "mk", [api_error(t - 2, WEEKLY)], registry="no-cwd")
        check("found by session id alone when the folder name cannot be derived",
              box.mod.session_transcript(sess, box.meta(sess)) == path)
        check("...and acted on", box.mod.watch_failed_turns_once(sess, {}) == "moved")

    with sandbox(clx) as box:
        two_accounts(box)
        t = time.time()
        sess, path = gateway_session(box, "mk", [api_error(t - 2, WEEKLY)], registry="none")
        check("no registry entry and no hook payload: nothing to read, nothing done",
              box.mod.watch_failed_turns_once(sess, {}) == "no-transcript"
              and box.link_target(sess) == ".claude-mk")
        meta = box.meta(sess)
        meta["transcript_path"] = path   # what the hook records in a session whose hooks are on
        box.mod.write_session_meta(sess, meta)
        check("a path the hook recorded is used as it is",
              box.mod.watch_failed_turns_once(sess, {"look_at": 0}) == "moved")

    with sandbox(clx) as box:
        two_accounts(box)
        t = time.time()
        sess, path = gateway_session(box, "mk", [answer(t - 30)])
        state = {}
        check("a transcript with no failure is clean", box.mod.watch_failed_turns_once(sess, state) == "clean")
        write_lines(path, [api_error(time.time() - 1, WEEKLY)], mode="a")
        check("a failure appended later is caught by the same watcher",
              box.mod.watch_failed_turns_once(sess, state) == "moved"
              and box.link_target(sess) == ".claude-ct", box.link_target(sess))


def t_auth(clx):
    # The login is refused on a real request; the file on disk still looks alive.
    with sandbox(clx) as box:
        two_accounts(box)
        t = time.time()
        creds = os.path.join(box.home, ".claude-mk", ".credentials.json")
        os.utime(creds, (t - 100, t - 100))
        sess, _ = gateway_session(box, "mk", [api_error(t - 2, REVOKED, error="authentication_failed",
                                                        status=401)])
        out = box.mod.watch_failed_turns_once(sess, {})
        entry = cache_of(box).get("mk") or {}
        check("auth: a revoked login moves the session at once",
              out == "moved" and box.link_target(sess) == ".claude-ct", (out, box.link_target(sess)))
        check("auth: recorded as the status a 401 from /usage leaves, against this file",
              entry.get("status") == "http-401" and entry.get("credsMtime") == os.stat(creds).st_mtime, entry)
        hand = (box.meta(sess).get("handoffs") or [{}])[-1]
        check("auth: the move carries the auth trigger",
              (hand.get("trigger") or {}).get("window") == "auth", hand)
        conf, accts = box.accounts()
        check("auth: the account is not offered to anybody else",
              box.mod.best_candidate(accts, {"ct"}, 90) is None,
              getattr(box.mod.best_candidate(accts, {"ct"}, 90), "id", None))
        # A good /usage answer for the same file clears the verdict (a transient 401).
        box.cache = cache_of(box)
        box.cache["mk"]["status"] = "ok"
        box.cache["mk"]["fetchedAt"] = int(time.time())
        box.flush_cache()
        conf, accts = box.accounts()
        check("auth: the next good measurement clears it",
              box.mod.auth_problem(box.by_id(accts, "mk")) is None, box.mod.auth_problem(box.by_id(accts, "mk")))

    # The credentials were replaced AFTER the request failed: the failure says nothing about them.
    with sandbox(clx) as box:
        two_accounts(box)
        t = time.time()
        sess, _ = gateway_session(box, "mk", [api_error(t - 20, REVOKED, error="authentication_failed",
                                                        status=401)])
        out = box.mod.watch_failed_turns_once(sess, {})
        check("auth: tokens written after the failure are not condemned by it",
              out == "recorded" and box.link_target(sess) == ".claude-mk"
              and (cache_of(box).get("mk") or {}).get("status") == "ok", (out, cache_of(box).get("mk")))

    # Claude Code blanked the file after the refusal: dead by the file itself.
    with sandbox(clx) as box:
        box.account("mk", "blank", five=1, seven=68, age=30, status="no-token")
        box.account("ct", "alive", five=5, seven=10, age=30)
        t = time.time()
        sess, _ = gateway_session(box, "mk", [api_error(t - 2, REVOKED, error="authentication_failed",
                                                        status=401)])
        out = box.mod.watch_failed_turns_once(sess, {})
        check("auth: a logged-out file moves the session whatever the cache says",
              out == "moved" and box.link_target(sess) == ".claude-ct", (out, box.link_target(sess)))


def t_final_and_busy(clx):
    with sandbox(clx) as box:
        two_accounts(box)
        t = time.time()
        sess, _ = gateway_session(box, "mk", [api_error(t - 2, WEEKLY)])
        out = box.mod.watch_failed_turns_once(sess, {}, final=True)
        check("final: nothing is moved for a session that has ended",
              out == "recorded" and box.link_target(sess) == ".claude-mk", (out, box.link_target(sess)))
        conf, accts = box.accounts()
        check("final: ...but the next launch sees the account as spent",
              box.mod.over_threshold(box.by_id(accts, "mk"), 90) is not None
              and box.mod.best_candidate(accts, set(), 90).id == "ct",
              box.mod.over_threshold(box.by_id(accts, "mk"), 90))
        rc, _, out, err = box.run_main(["--status"])
        check("final: clx --status says the account answered with a limit",
              rc == 0 and "limit hit" in out and "Mk" in out, out[-600:])

    with sandbox(clx) as box:
        two_accounts(box)
        t = time.time()
        sess, _ = gateway_session(box, "mk", [api_error(t - 2, WEEKLY)])
        state = {}
        with box.mod.SessionLock(sess) as lock:
            held = lock.held
            out = box.mod.watch_failed_turns_once(sess, state)
        check("busy: a tick the hook locked out stores nothing",
              held and out == "busy" and state.get("pos") is None and box.link_target(sess) == ".claude-mk",
              (held, out, state))
        out = box.mod.watch_failed_turns_once(sess, state)
        check("busy: the next tick reads the same line and acts",
              out == "moved" and box.link_target(sess) == ".claude-ct", (out, box.link_target(sess)))


def t_loop(clx):
    """The real watcher loop, on a fast tick: a live session, then one whose process is gone."""
    os.environ["CC_HEAL_TICK"] = "0.05"
    try:
        with sandbox(clx) as box:
            two_accounts(box)
            t = time.time()
            sess, path = gateway_session(box, "mk", [answer(t - 30)])
            worker = threading.Thread(target=box.mod.heal_watch_loop, args=(sess,), daemon=True)
            worker.start()
            time.sleep(0.3)
            check("loop: a healthy session is left alone", box.link_target(sess) == ".claude-mk")
            write_lines(path, [api_error(time.time(), WEEKLY)], mode="a")
            deadline = time.time() + 5
            while time.time() < deadline and box.link_target(sess) != ".claude-ct":
                time.sleep(0.05)
            took = 5 - (deadline - time.time())
            check("loop: the running watcher moves the session within a few ticks",
                  box.link_target(sess) == ".claude-ct", "after %.2f s: %s" % (took, box.link_target(sess)))
            time.sleep(0.3)
            check("loop: the link the hand-off wrote is not 'healed' back",
                  box.link_target(sess) == ".claude-ct" and box.meta(sess).get("account_id") == "ct",
                  (box.link_target(sess), box.meta(sess).get("account_id")))
            shutil.rmtree(sess, ignore_errors=True)
            worker.join(3)
            check("loop: the watcher ends with its session", not worker.is_alive())

        with sandbox(clx) as box:
            two_accounts(box)
            t = time.time()
            sess, path = gateway_session(box, "mk", [api_error(t - 1, WEEKLY)])
            gone = os.path.join(os.path.dirname(sess), "2147483001")   # no such process
            os.rename(sess, gone)
            os.rename(os.path.join(gone, "sessions", os.path.basename(sess) + ".json"),
                      os.path.join(gone, "sessions", "2147483001.json"))
            worker = threading.Thread(target=box.mod.heal_watch_loop, args=(gone,), daemon=True)
            worker.start()
            worker.join(8)
            check("loop: a session whose process is gone ends the watcher", not worker.is_alive())
            check("loop: ...after its last failed turn was recorded for the next launch",
                  "limitHit" in (cache_of(box).get("mk") or {}), cache_of(box).get("mk"))
    finally:
        os.environ.pop("CC_HEAL_TICK", None)


def main():
    global VERBOSE
    ap = argparse.ArgumentParser()
    ap.add_argument("--clx", default=dead.DEFAULT_CLX)
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()
    VERBOSE = args.verbose
    for case in (t_scan, t_limit, t_ignored, t_foreign_credentials, t_gateway_launch,
                 t_finding_the_transcript, t_auth, t_final_and_busy, t_loop):
        try:
            case(args.clx)
        except Exception as exc:
            import traceback
            check("%s raised" % case.__name__, False,
                  "%s: %s\n%s" % (type(exc).__name__, exc, traceback.format_exc()[-900:]))
    print("failed-turn: %d passed, %d failed  (%s)" % (PASS, FAIL, args.clx))
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
