#!/usr/bin/env python3
"""Sandbox assertions: which account a launch picks when every account is spent.

A parked account is never launched while an unparked one can still answer,
with or without a primary configured: an account at 95% beats breaking a park.
Only when parked or dead logins are all there is does clx fall back to one.

Everything runs in test-dead-auth.py's throw-away HOME with FAKE tokens and no
network. Usage:  python3 test/test-launch.py [--clx PATH] [-v]
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
NOW = dead.NOW

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


def park(aid):
    return {aid: {"until": None, "since": int(NOW), "reason": "test"}}


def launch(clx, primary, parked, spent):
    """-> (chosen id, reason) with `parked` at 10% and `spent` at 95% on 7d."""
    with dead.sandbox(clx) as box:
        box.account(parked, "alive", five=10, seven=10, age=30)
        box.account(spent, "alive", five=20, seven=95, age=30)
        box.conf(primary=primary, paused=park(parked))
        conf, accts = box.accounts()
        chosen, _nxt, reason, _notes = box.mod.select(accts, conf)
        return chosen.id, reason


def only_parked(clx, primary):
    with dead.sandbox(clx) as box:
        box.account("aa", "alive", five=10, seven=10, age=30)
        box.conf(primary=primary, paused=park("aa"))
        conf, accts = box.accounts()
        chosen, _nxt, reason, _notes = box.mod.select(accts, conf)
        return chosen.id, reason


def main():
    global VERBOSE
    ap = argparse.ArgumentParser()
    ap.add_argument("--clx", default=dead.DEFAULT_CLX)
    ap.add_argument("-v", action="store_true")
    args = ap.parse_args()
    VERBOSE = args.v

    got = launch(args.clx, "", "aa", "bb")
    check("no primary: a spent unparked account beats a parked one", got[0] == "bb", repr(got))
    got = launch(args.clx, "nobody", "aa", "bb")
    check("primary not logged in: the same", got[0] == "bb", repr(got))
    got = launch(args.clx, "aa", "aa", "bb")
    check("parked primary: a spent unparked account beats it", got[0] == "bb", repr(got))
    got = only_parked(args.clx, "")
    check("only a parked account exists: launch on it rather than refuse", got[0] == "aa", repr(got))

    print("launch: %d passed, %d failed  (%s)" % (PASS, FAIL, args.clx))
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
