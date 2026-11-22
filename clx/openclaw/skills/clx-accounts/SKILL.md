---
name: clx-accounts
description: Which Claude account your Claude CLI turns run on, what happens at a usage limit, and how to pause or resume an account with clx.
---
<!-- clx-openclaw managed file: `clx-openclaw remove` deletes it, `clx-openclaw setup --with-skill` rewrites it. -->

# Claude accounts through clx

On this host the OpenClaw gateway runs its Claude CLI through **clx**. The gateway starts `claude`
from its PATH, and the first `claude` there is clx's shim. That route was verified on OpenClaw
2026.11.3 only. clx starts each CLI session on the account with the most room, and it moves a
running session to another account when its account runs out. You never have to switch accounts
yourself.

## See where you stand

```bash
clx --status
```

- One row per account, with one column per limit window (`5H`, `7D`, a per-model weekly cap such
  as `WK-FABLE`). The values are percent used.
- `*` marks the account the last launch chose. `P` marks the primary.
- A value ending in `·` belongs to a window that does not bind the model in use. It does not count.
- `STATUS` is `ok` for a measured account. A dead login shows its reason instead (`logged out`,
  `login expired`, `token rejected`). A parked account shows how long it stays parked.
- `limit hit: <account> answered "..."` means a real request just failed on that account's limit.
  clx counts that window as 100 % until it resets or the usage endpoint measures it again.
- `would launch:` names the account a new session would start on, and `next:` the one after it.
- `sessions` lists every live clx session, with the account it runs on and its hand-offs.

`clx-openclaw status` shows the gateway side: whether the running gateway's `claude` is the shim,
the live sessions, and the last moves after failed turns.

## What happens at a limit

- When a turn fails with "You've hit your … limit", "You've reached your … limit" or a refused
  login ("OAuth token revoked"), clx's watcher reads it from the session transcript. It records the
  failure against that account and moves the session to the account with the most room. The move
  takes a few seconds. Then send the turn again: it runs on the new account.
- clx also moves a session when its account reaches the usage threshold (90 % by default) on any
  window, but at most once every ten minutes for that reason. It moves at once from a parked
  account or a dead login.
- When every account is spent, the session stays where it is and `clx --status` says so. Wait for
  the reset time it shows. Do not retry in a loop.
- Overloads, timeouts and plain API rate limits are not the account's fault. clx does not move a
  session for them.

## Pause and resume an account

```bash
clx --pause <name> --days 3          # or --until 2026-12-01, or --until never
clx --pause <name> --reason "lent out"
clx --unpause <name>                 # inside a clx session; outside one, clx --resume <name> works too
```

A paused account is never launched on and never handed a session. Sessions on it are moved off.
Its login is not touched. `<name>` is the account's name from `clx --status` (the `work` of
`~/.claude-work`).

## Never edit by hand

- `~/.claude*/.credentials.json`: the logins. To fix a dead login, ask the operator to run
  `cm-login <name>` in a terminal. Do not run `/login` inside a session: it signs in as whoever
  the browser holds.
- `~/.clx-sessions/`: live session dirs. Deleting or re-pointing anything there breaks running
  sessions.
- `~/.claude/cc-usage-cache.json`, `~/.claude/active-account.json` and
  `~/.claude/clx-handoff.log`: clx's own records.
- `~/.claude/cc.json`: the operator's settings (threshold, primary account). Pause and resume
  accounts with `clx --pause` and `clx --unpause`, never by editing its `paused` block.
- `~/.local/share/clx/openclaw/` (the shim and its files) and the gateway's drop-in
  (`~/.config/systemd/user/<unit>.d/zz-clx-openclaw.conf`): `clx-openclaw setup` and
  `clx-openclaw remove` own them.

## What clx does not cover

clx only rotates sessions that run through the Claude CLI on this host. An agent whose model runs
on OpenClaw's own runtime, with an Anthropic API key or an auth profile, never starts the CLI.
clx does not rotate it. The same goes for a launch whose caller hands over
`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`.
