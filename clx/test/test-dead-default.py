#!/usr/bin/env python3
"""Sandbox assertions: a dead login never wins over a live login of the same account.

Defect: the primary in cc.json named the default dir, and the same account was also
signed in to ~/.claude-<name>. When ~/.claude/.credentials.json came back blank - or
held no login at all, only the MCP sign-ins Claude Code writes when it starts without
one - clx's "one dir per account" rule still kept the default dir for the primary. The
live login was ignored and a running session was re-linked to the dead one.

Throw-away HOME, FAKE tokens, no network (test-dead-auth.py's Box).
Usage:  python3 test/test-dead-default.py [--clx PATH] [-v]
Exit 0 when every assertion passes.
"""
import argparse
import importlib.machinery
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
_loader = importlib.machinery.SourceFileLoader("dead_auth", os.path.join(HERE, "test-dead-auth.py"))
_spec = importlib.util.spec_from_loader("dead_auth", _loader)
dead = importlib.util.module_from_spec(_spec)
_loader.exec_module(dead)

sandbox = dead.sandbox
PASS = FAIL = 0
VERBOSE = False
EMAIL = "mk@example.test"


def check(name, ok, detail=""):
    global PASS, FAIL
    if ok:
        PASS += 1
        if VERBOSE:
            print("PASS  %s" % name)
    else:
        FAIL += 1
        print("FAIL  %s  %s" % (name, detail))


def default_login(box, kind, email=EMAIL):
    """A login in the DEFAULT dir: ~/.claude/.credentials.json, its account in ~/.claude.json."""
    box.write_json(os.path.join(box.home, ".claude", ".credentials.json"), {"claudeAiOauth": dead.creds(kind)})
    box.write_json(os.path.join(box.home, ".claude.json"), {"oauthAccount": {"emailAddress": email}})


# A credentials file Claude Code writes when it runs WITHOUT a login: MCP sign-ins only.
MCP_ONLY = {"mcpOAuth": {"example-server|0000000000000000": {
    "serverName": "example-server", "serverUrl": "https://mcp.example.test", "accessToken": "",
    "discoveryState": {"authorizationServerUrl": "https://example.test", "oauthMetadataFound": True,
                       "authServerMetadataUrl": None, "tokenlessRejectedAt": 1768465800000}}}}


def default_file(box, doc, email=EMAIL):
    """The DEFAULT dir's credentials file with exactly this content (a dict, or raw text)."""
    path = os.path.join(box.home, ".claude", ".credentials.json")
    if isinstance(doc, str):
        with open(path, "w") as fh:
            fh.write(doc)
    else:
        box.write_json(path, doc)
    box.write_json(os.path.join(box.home, ".claude.json"), {"oauthAccount": {"emailAddress": email}})


def kept_dir(box):
    conf, accts = box.accounts()
    mine = [a for a in accts if a.email == EMAIL]
    return (os.path.basename(mine[0].dir) if len(mine) == 1 else "%d accounts" % len(mine)), accts


def t_dedupe(clx):
    for primary in ("default", "mk"):
        with sandbox(clx) as box:
            box.conf(primary=primary)
            box.account("mk", "alive", five=10, seven=20, age=30, email=EMAIL)
            box.account("ct", "alive", five=5, seven=10, age=30)
            default_login(box, "blank")
            got, accts = kept_dir(box)
            check("primary %r: a blank default login loses to the live named dir" % primary,
                  got == ".claude-mk", got)
            best = box.mod.best_candidate(accts, {"ct"}, 90)
            check("primary %r: ...and the account is still offered, on its live dir" % primary,
                  best is not None and os.path.basename(best.dir) == ".claude-mk", getattr(best, "dir", None))
            notes = box.mod.dedupe(box.mod.discover(), primary)[1]
            check("primary %r: the note says why" % primary,
                  len(notes) == 1 and "dead login" in notes[0], notes)

    with sandbox(clx) as box:
        box.conf(primary="default")
        box.account("mk", "alive", five=10, seven=20, age=30, email=EMAIL)
        default_login(box, "expired")
        check("an expired default login loses too", kept_dir(box)[0] == ".claude-mk", kept_dir(box)[0])

    with sandbox(clx) as box:
        box.conf(primary="default")
        box.account("mk", "blank", five=10, seven=20, age=30, email=EMAIL)
        default_login(box, "alive")
        check("a dead NAMED dir loses to the live default dir", kept_dir(box)[0] == ".claude", kept_dir(box)[0])

    # Nothing changes when the facts do not decide.
    with sandbox(clx) as box:
        box.conf(primary="default")
        box.account("mk", "alive", five=10, seven=20, age=30, email=EMAIL)
        default_login(box, "alive")
        check("both alive, primary is the default dir: the default dir is kept (old rule)",
              kept_dir(box)[0] == ".claude", kept_dir(box)[0])
        notes = box.mod.dedupe(box.mod.discover(), "default")[1]
        check("both alive: the old note is kept", len(notes) == 1 and "rotated refresh token" in notes[0], notes)
    with sandbox(clx) as box:
        box.conf(primary="other")
        box.account("mk", "alive", five=10, seven=20, age=30, email=EMAIL)
        default_login(box, "alive")
        check("both alive, not the primary: the named dir is kept (old rule)",
              kept_dir(box)[0] == ".claude-mk", kept_dir(box)[0])
    with sandbox(clx) as box:
        box.conf(primary="default")
        box.account("mk", "blank", five=10, seven=20, age=30, email=EMAIL)
        default_login(box, "blank")
        check("both dead: the old rule decides", kept_dir(box)[0] == ".claude", kept_dir(box)[0])
    with sandbox(clx) as box:
        box.conf(primary="default")
        box.account("mk", "refreshable", five=10, seven=20, age=30, email=EMAIL)
        default_login(box, "alive")
        check("an expired access token with a good refresh token is NOT dead (old rule decides)",
              kept_dir(box)[0] == ".claude", kept_dir(box)[0])


def t_no_login_in_the_file(clx):
    """The file that came back held only MCP sign-ins - no Claude login at all."""
    with sandbox(clx) as box:
        m = box.mod
        d = os.path.join(box.home, ".claude")
        default_file(box, MCP_ONLY)
        facts = m.creds_facts(d)
        check("a file with only MCP sign-ins has the facts of a logged-out account",
              isinstance(facts, dict) and facts.get("access") is False and facts.get("refresh") is False, facts)
        default_file(box, {})
        check("an empty object too", (m.creds_facts(d) or {}).get("access") is False, m.creds_facts(d))
        default_file(box, "{not json")
        check("a half-written file is still NOT evidence", m.creds_facts(d) is None, m.creds_facts(d))
        default_file(box, "")
        check("nor is an empty file", m.creds_facts(d) is None, m.creds_facts(d))
        default_file(box, "[1, 2]")
        check("nor is a file that is not an object", m.creds_facts(d) is None, m.creds_facts(d))
        default_file(box, {"claudeAiOauth": "broken"})
        check("nor a login block of the wrong kind", m.creds_facts(d) is None, m.creds_facts(d))
        path = os.path.join(d, ".credentials.json")
        default_file(box, MCP_ONLY)
        os.chmod(path, 0)
        try:
            unreadable = os.access(path, os.R_OK)  # root reads it anyway: then the check means nothing
            check("nor a file clx may not read", unreadable or m.creds_facts(d) is None, m.creds_facts(d))
        finally:
            os.chmod(path, 0o600)

    for primary in ("default", "mk"):
        with sandbox(clx) as box:
            box.conf(primary=primary)
            box.account("mk", "alive", five=10, seven=20, age=30, email=EMAIL)
            box.account("ct", "alive", five=5, seven=10, age=30)
            default_file(box, MCP_ONLY)
            got, accts = kept_dir(box)
            check("primary %r: the MCP-only default file loses to the live named dir" % primary,
                  got == ".claude-mk", got)

    # Alone (no second dir of that account): never a launch choice, never a hand-off target.
    with sandbox(clx) as box:
        box.conf(primary="default")
        default_file(box, MCP_ONLY, email="solo@example.test")
        box.account("ct", "alive", five=95, seven=10, age=30)
        conf, accts = box.accounts()
        solo = [a for a in accts if a.email == "solo@example.test"]
        check("alone: the account is known as logged out",
              len(solo) == 1 and box.mod.auth_problem(solo[0]) == "logged out",
              [box.mod.auth_problem(a) for a in solo])
        check("alone: it is never offered to a session", box.mod.best_candidate(accts, {"ct"}, 90, allow_stale=True) is None,
              getattr(box.mod.best_candidate(accts, {"ct"}, 90, allow_stale=True), "id", None))

    with sandbox(clx) as box:
        box.conf(primary="default")
        box.account("mk", "alive", five=10, seven=20, age=30, email=EMAIL)
        box.account("ct", "alive", five=5, seven=10, age=30)
        sess = box.session_on("mk")
        default_file(box, MCP_ONLY)   # exactly what happened while a session was running
        box.mod.watch_heal_once(sess)
        box.mod.watch_decide_once(sess)
        check("a running session is not re-linked to the MCP-only default file",
              box.link_target(sess) == ".claude-mk" and "relink" not in box.log() and not box.meta(sess).get("handoffs"),
              (box.link_target(sess), box.log()[-200:], box.meta(sess).get("handoffs")))


def t_running_session(clx):
    # The blank default login came back while a session ran on the named dir.
    with sandbox(clx) as box:
        box.conf(primary="default")
        box.account("mk", "alive", five=10, seven=20, age=30, email=EMAIL)
        box.account("ct", "alive", five=5, seven=10, age=30)
        sess = box.session_on("mk")
        default_login(box, "blank")   # the blank file comes back while the session runs
        out = box.mod.watch_heal_once(sess)
        check("a running session is not re-linked to the blank default login",
              box.link_target(sess) == ".claude-mk" and "relink" not in box.log(), (out, box.link_target(sess), box.log()[-200:]))
        out = box.mod.watch_decide_once(sess)
        check("...and stays on its live account at the next decision",
              box.link_target(sess) == ".claude-mk" and not box.meta(sess).get("handoffs"),
              (out, box.link_target(sess), box.meta(sess).get("handoffs")))


def main():
    global VERBOSE
    ap = argparse.ArgumentParser()
    ap.add_argument("--clx", default=dead.DEFAULT_CLX)
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()
    VERBOSE = args.verbose
    for case in (t_dedupe, t_no_login_in_the_file, t_running_session):
        try:
            case(args.clx)
        except Exception as exc:
            import traceback
            check("%s raised" % case.__name__, False, "%s: %s\n%s" % (type(exc).__name__, exc, traceback.format_exc()[-900:]))
    print("dead-default: %d passed, %d failed  (%s)" % (PASS, FAIL, args.clx))
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
