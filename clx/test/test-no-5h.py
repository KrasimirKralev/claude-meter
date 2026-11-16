#!/usr/bin/env python3
"""Sandbox assertions: clx keeps deciding when /usage reports NO 5-hour window.

Defect (found 2026-11-09): the usage feed stopped carrying a 5h window on every
account (`five_hour: null`; 7d and "Weekly (Fable)" still arrive). `known()`
meant "has a 5h number", so every account read as UNKNOWN and nothing was ever
"spent":
  * no hand-off on 7d or on the Fable cap (one account sat at Weekly (Fable) 90%
    against a threshold of 90 and evaluated as not spent);
  * targets were picked in list order (the "unknown" last resort), not by room;
  * the launch check on the primary and the "/model opus" hint never fired.

Everything runs in a throw-away HOME with FAKE tokens and no network - the
sandbox is test-dead-auth.py's Box, loaded from the file next to this one.

Usage:  python3 test/test-no-5h.py [--clx PATH] [-v]
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

sandbox, NOW = dead.sandbox, dead.NOW
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
        print("FAIL  %s  %s" % (name, detail))


def measured(box, aid, seven=None, fable=None, five=None, kind="alive", age=30):
    """An account whose cache entry has exactly the windows named - 5h only if given."""
    d = box.account(aid, kind)  # five=None there: no cache entry is written yet
    windows = {}
    if five is not None:
        windows["five_hour"] = {"utilization": five, "resets_at": None, "label": "5h"}
    if seven is not None:
        windows["seven_day"] = {"utilization": seven, "resets_at": None, "label": "7d"}
    if fable is not None:
        windows["weekly_fable"] = {"utilization": fable, "resets_at": None,
                                   "label": "Weekly (Fable)", "model": "Fable",
                                   "model_family": "fable"}
    box.cache[aid] = {"five_hour": five, "seven_day": seven, "resets_at": None,
                      "windows": windows, "fetchedAt": int(NOW - age), "status": "ok",
                      "checkedAt": int(NOW), "email": "%s@example.test" % aid, "dir": d}
    box.flush_cache()
    return d


def on_model(box, model):
    box.mod.session_model = lambda payload=None: model


def today(box):
    """The 2026-11-09 cache: no 5h anywhere, one account's Fable cap at the threshold."""
    measured(box, "cw", seven=22, fable=10)
    measured(box, "kr", seven=13, fable=12)
    measured(box, "mk", seven=73, fable=90)
    measured(box, "yk", seven=7, fable=9)


# ------------------------------------------------------------------- the cases


def t_fable_trigger(clx):
    with sandbox(clx) as box:
        today(box)
        on_model(box, "fable")
        sess = box.session_on("mk")
        box.hook(sess, "prompt")
        check("a Fable session on a spent Fable cap is handed off (no 5h window)",
              box.link_target(sess) != ".claude-mk", "still on %s" % box.link_target(sess))
        check("the target is the account with the most room, not list order",
              box.link_target(sess) == ".claude-yk", "went to %s" % box.link_target(sess))
        check("the move is logged with the Fable window as the trigger",
              "Weekly (Fable) 90%" in box.log(), box.log()[-300:])

    with sandbox(clx) as box:
        today(box)
        on_model(box, "fable")
        sess = box.session_on("mk")
        box.mod.watch_decide_once(sess)
        check("the watcher moves an idle Fable session too",
              box.link_target(sess) == ".claude-yk", "on %s" % box.link_target(sess))

    with sandbox(clx) as box:
        today(box)
        on_model(box, "opus")
        sess = box.session_on("mk")
        box.hook(sess, "prompt")
        check("guard: an Opus session ignores the Fable cap (7d 73% is under)",
              box.link_target(sess) == ".claude-mk", "moved to %s" % box.link_target(sess))


def t_seven_day_trigger(clx):
    with sandbox(clx) as box:
        measured(box, "kr", seven=13, fable=12)
        measured(box, "mk", seven=95, fable=20)
        measured(box, "yk", seven=40, fable=9)
        on_model(box, "opus")
        sess = box.session_on("mk")
        box.hook(sess, "prompt")
        check("a spent 7d window still triggers without a 5h window",
              box.link_target(sess) == ".claude-kr", "on %s" % box.link_target(sess))


def t_target_needs_fable_room(clx):
    with sandbox(clx) as box:
        measured(box, "cw", seven=50, fable=20)
        measured(box, "kr", seven=30, fable=95)
        measured(box, "yk", seven=5, fable=96)
        on_model(box, "fable")
        sess = box.session_on("kr")
        box.hook(sess, "prompt")
        check("a Fable session never lands on an account whose Fable cap is spent",
              box.link_target(sess) == ".claude-cw", "on %s" % box.link_target(sess))


def t_fable_spent_everywhere(clx):
    with sandbox(clx) as box:
        measured(box, "cw", seven=22, fable=97)
        measured(box, "kr", seven=13, fable=100)
        measured(box, "yk", seven=7, fable=91)
        on_model(box, "fable")
        sess = box.session_on("kr")
        text = box.hook(sess, "prompt")
        check("Fable spent on every account: the session stays put",
              box.link_target(sess) == ".claude-kr", "moved to %s" % box.link_target(sess))
        check("... and is told to switch the model, not left stuck in silence",
              "/model opus" in text, repr(text))

    with sandbox(clx) as box:
        measured(box, "cw", seven=22, fable=97)
        measured(box, "kr", seven=13, fable=100)
        measured(box, "yk", seven=7, fable=91)
        on_model(box, "fable")
        sess = box.session_on("kr")
        box.mod.watch_decide_once(sess)
        check("... and the watcher raises the 'switch the model' notice",
              any("/model opus" in n[0] for n in box.notes), box.notes)


def t_launch(clx):
    with sandbox(clx) as box:
        today(box)
        conf, accts = box.accounts()
        box.mod.apply_model(accts, "fable")
        chosen, nxt, reason, notes = box.mod.select(accts, conf)
        check("launch on Fable skips a primary whose Fable cap is spent",
              chosen.id == "yk", "chose %s (%s)" % (chosen.id, reason))

    with sandbox(clx) as box:
        today(box)
        box.conf(primary="kr")
        conf, accts = box.accounts()
        box.mod.apply_model(accts, "fable")
        chosen, nxt, reason, notes = box.mod.select(accts, conf)
        check("guard: a primary with room is still launched on",
              chosen.id == "kr" and reason == "primary under threshold",
              "chose %s (%s)" % (chosen.id, reason))
        check("the 'next' account is the one with the most room",
              nxt is not None and nxt.id == "yk", "next %s" % (nxt and nxt.id))

    with sandbox(clx) as box:
        today(box)
        box.conf(primary="kr")
        rc, launched, out, err = box.run_main([])
        check("the launch banner names a real window, never '5h ?'",
              launched is not None and "5h ?" not in err and "7d 13%" in err, err[-300:])


def t_dead_login_target(clx):
    with sandbox(clx) as box:
        measured(box, "aa", seven=10, fable=10, kind="blank")
        measured(box, "bb", seven=80, fable=10)
        measured(box, "cc", seven=5, fable=10)
        on_model(box, "opus")
        sess = box.session_on("aa")
        box.hook(sess, "prompt")
        check("a session leaving a dead login goes to the most room, not list order",
              box.link_target(sess) == ".claude-cc", "on %s" % box.link_target(sess))


def t_mixed_and_unknown(clx):
    with sandbox(clx) as box:
        measured(box, "aa", seven=95)
        measured(box, "bb", seven=20, five=10)
        measured(box, "cc", seven=20)  # same worst as bb, but no 5h number
        conf, accts = box.accounts()
        try:
            got = box.mod.best_candidate(accts, {"aa"}, 90)
            check("a tie between an account with a 5h number and one without does not raise",
                  got is not None and got.id in ("bb", "cc"), "got %s" % (got and got.id))
        except TypeError as exc:
            check("a tie between an account with a 5h number and one without does not raise",
                  False, "TypeError: %s" % exc)

    with sandbox(clx) as box:
        measured(box, "aa", seven=95)
        measured(box, "bb", seven=40)
        box.account("ab", "alive")  # logged in, never measured, FIRST in list order
        conf, accts = box.accounts()
        got = box.mod.best_candidate(accts, {"aa"}, 90)
        check("a measured account with room beats one that was never measured",
              got is not None and got.id == "bb", "got %s" % (got and got.id))
        never = box.by_id(accts, "ab")
        check("guard: an account with no measured window is still 'unknown'",
              not box.mod.known(never))


def main():
    global VERBOSE
    ap = argparse.ArgumentParser()
    ap.add_argument("--clx", default=dead.DEFAULT_CLX)
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()
    VERBOSE = args.verbose
    for case in (t_fable_trigger, t_seven_day_trigger, t_target_needs_fable_room,
                 t_fable_spent_everywhere, t_launch, t_dead_login_target, t_mixed_and_unknown):
        try:
            case(args.clx)
        except Exception as exc:
            import traceback
            check("%s raised" % case.__name__, False,
                  "%s: %s\n%s" % (type(exc).__name__, exc, traceback.format_exc()[-800:]))
    print("no-5h: %d passed, %d failed  (%s)" % (PASS, FAIL, args.clx))
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
