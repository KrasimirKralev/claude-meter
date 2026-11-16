# clx

**Run Claude Code across several Claude accounts, and move a running session to another account when one runs out.**

`clx` starts Claude Code on whichever of your accounts has the most room left. When that account reaches its limit in the middle of your work, clx moves the same running session to your next account. You don't restart, don't run `--continue`, and don't lose the subagents or background tasks that are running.

> Linux only. Unofficial; not affiliated with Anthropic.
>
> **Home: [github.com/KrasimirKralev/clx](https://github.com/KrasimirKralev/clx).** This folder is a copy of the latest clx release, kept here so Claude Meter and clx ship together. Issues and pull requests go to the clx repo.

## How it works

Claude Code keeps each login in a config dir (`CLAUDE_CONFIG_DIR`). It reads that dir's `.credentials.json` again on every request.

1. **One dir per account.** Each account lives in `~/.claude-<name>`. Your usual `~/.claude` login counts as an account too.
2. **One session dir per run.** `clx` starts each interactive Claude Code in its own dir, `~/.clx-sessions/<pid>`. That dir's `.credentials.json` is a symlink into one account's dir.
3. **A hook checks usage.** The hook `cc-handoff.sh` runs on each prompt, at the end of each turn, and after tool calls (throttled to one real check every 20 s). It compares the account's usage with your threshold (90% by default). It reads a local cache and never waits on the network.
4. **The session moves when it hits the threshold.** clx re-points the symlink to the account with the most room on every limit window (the 5-hour, weekly and per-model limits the server reports). The next request goes out on the new account. A one-line note in the session says that it moved.
5. **Idle sessions are covered too.** A small watcher per session makes the same check every 30 s. That covers a session that is waiting on background agents and so sends no hook events.

clx never sees your password. It reads the token Claude Code already has, only to ask Anthropic's usage endpoint how full each account is.

## Install

You need Linux, `python3` (standard library only) and [Claude Code](https://claude.com/claude-code) logged in at least once.

```bash
curl -fsSL https://github.com/KrasimirKralev/clx/releases/latest/download/clx.tar.gz | tar xz
./clx/install.sh            # add --alias to make a plain `claude` go through clx
```

The installer puts `clx`, `clx-move` and `cm-login` in `~/.local/bin` and the hook in `~/.claude/hooks/`. It registers the hook in `~/.claude/settings.json` (it backs up the file first and keeps everything else). It changes nothing outside those paths. To remove all of it, run `./clx/install.sh --uninstall`.

## Use

```bash
cm-login work you@work.example     # log a second account into ~/.claude-work
clx --status                       # every account, its usage, and which one clx would pick
clx                                # start Claude Code on the account with the most room
clx -c                             # same, continuing your last conversation
```

Every other argument goes straight to `claude`, so `clx -p "…"`, `clx --model …` and the rest work as usual.

| Command | What it does |
|---|---|
| `clx --status` | Table of accounts: usage per window, refill time, login state, live sessions. |
| `clx --use <name>` | Start on that account, whatever its usage. |
| `clx --sync` | Fetch usage for every account now instead of from the 3-minute cache. |
| `clx --pause <name> [--days N \| --until YYYY-MM-DD \| --until never]` | Park an account (lent out, saved for later). clx never starts on it and moves sessions off it. |
| `clx --resume <name>` | Put a parked account back in service (inside a session, use `--unpause`). |
| `clx --init` | Link your shared settings, `CLAUDE.md`, skills, agents, plugins, hooks and project history into every `~/.claude-*` dir, so each account behaves the same. `clx` also does this by itself for a new account. Anything it replaces is moved aside as `*.pre-clx`. |
| `cm-login <name> [email]` | Log an account into `~/.claude-<name>`. If your browser is already signed in to another account, open the login link in a private window. |
| `cm-login status` | Who is logged in to which dir. |

### Settings

`~/.claude/cc.json` (optional):

```json
{ "threshold": 90, "primary": "work" }
```

- `threshold`: the usage % at which a session moves on.
- `primary`: the account to prefer while it is under the threshold. With no primary, clx starts on the account with the most room.

`CC_THRESHOLD` and `CC_PRIMARY` override them for one run. `CLX_NO_NOTIFY=1` turns off the desktop popup that a move shows.

## With Claude Meter

[Claude Meter](https://github.com/KrasimirKralev/claude-meter) works without clx. With clx installed, it adds three things:

- The meter's **Active** badge follows the account your clx sessions are on.
- A **dead login** is flagged in the meter using clx's verdict.
- **Clicking an account** in the meter moves every running clx session to it. That click runs `clx-move <name>`. Clicks on an account that is at or over the threshold are refused, with the reason shown.

## Limits

- **Linux only.** clx relies on `/proc`, Linux file locks and Claude Code keeping its login in `.credentials.json`. It has not been tried on macOS, and the installer refuses to run there.
- **Only sessions started through `clx` can move.** A plain `claude` gets a one-line nudge to exit and run `clx -c` instead. `install.sh --alias` routes `claude` through clx.
- **A session in a rate-limit countdown waits for you after a move.** Press Esc and type `continue`. The popup says so.
- **When every account is over the threshold, the session stays where it is.** clx tells you so. If only a per-model weekly cap blocks you, it suggests switching the model instead.

## Tests

The tests run in a throw-away `HOME` with fake tokens and no network:

```bash
python3 clx/test/test-dead-auth.py   # a dead login is never a launch choice or a hand-off target
python3 clx/test/test-no-5h.py       # decisions when the server reports no 5-hour window
python3 clx/test/test-move.py        # clx-move, the meter's click
python3 clx/test/test-launch.py      # which account a launch picks when every one is spent
python3 clx/test/test-security.py    # one check per fixed security finding
bash    clx/test/test-install.sh     # install, first launch, second account, folder trust, uninstall
```

MIT licensed, like the rest of this repo.
