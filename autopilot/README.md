# Autopilot for opencode

Autopilot keeps agents working while you are away. It is a single plugin file
with no dependencies. It works with any agent, including the agent team.

## What it does

While autopilot is on for a session:

- **The agent is prompted to keep going.** Every time a turn ends, the agent is
  told to continue: check on anything it was waiting for, take the recommended
  option on any choice it offered, and keep working. This repeats until the
  agent ends a reply with `AUTOPILOT DONE`, or until 200 rounds have run.
- **The agent never waits on you.** The question tool is removed. Permission
  prompts are answered automatically. Risky commands are refused instead, and
  the agent is told to find a safer way. Those include force pushes, hard
  resets, recursive deletes of absolute paths, `sudo`, piping a download into a
  shell, global installs, publishing, registry edits and shutdowns. Edits
  outside the project directory are refused too.
- **Hung turns are restarted.** A turn with no activity for 30 minutes is
  interrupted and continued.
- **Failed turns are retried.** Rate limits and network errors are retried with
  backoff. Autopilot gives up after 8 failures in a row.
- **Subagents follow the same rules.** Subagent sessions started by the agent
  never ask questions or wait for approval either. Autopilot does not prompt
  the main agent while any of its subagents are still running.

## Use

In any session, in the app, TUI or CLI:

```
/autopilot <the task>
```

This turns autopilot on and starts the task. Other forms:

- `/autopilot` on its own turns autopilot on and tells the agent to continue
  what it was doing.
- `/autopilot status` shows the current round.
- `/autopilot off` turns it off.

Pressing stop on a running turn also turns autopilot off for that session.

Any agent whose name contains `autopilot` has autopilot on automatically.

## Install

Copy `plugins/autopilot.js` into your global opencode plugins folder, then
restart opencode (or the background service):

- Windows: `%USERPROFILE%\.config\opencode\plugins\autopilot.js`
- macOS and Linux: `~/.config/opencode/plugins/autopilot.js`

On Windows, from this folder:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.config\opencode\plugins" | Out-Null
Copy-Item plugins\autopilot.js "$env:USERPROFILE\.config\opencode\plugins\"
opencode service restart
```

To install it for one project only, put the file in that project's
`.opencode/plugins/` folder instead.

## Settings

The defaults are set at the top of `autopilot.js` in `DEFAULTS`:

| Setting | Default | Meaning |
| --- | --- | --- |
| `maxRounds` | 200 | Most continue prompts per task |
| `delay` | 10 | Seconds to wait after a turn ends before continuing |
| `stallMinutes` | 30 | Silence before a running turn is restarted |
| `maxFailures` | 8 | Failed turns in a row before giving up |
| `allowExternal` | false | Allow edits outside the project directory |

To change what counts as risky, edit the `RISKY` list in the same file.

## Notes

- Autopilot state lives in memory. If the opencode server restarts, run
  `/autopilot` again in the session, or use an agent with `autopilot` in its
  name.
- Autopilot can only refuse commands that match its risky list. Leave it on
  only in projects where you are happy for the agent to run ordinary commands
  unattended, and keep work on a branch.

Tested against opencode 2.0.26 with a scripted model. The agent was prompted to
continue after it stopped to ask a question, and autopilot turned off on
`AUTOPILOT DONE`. A shell command that would normally ask for permission ran,
and `git push --force` was refused with a message the model saw. Sessions
without autopilot behaved as before: they kept the question tool and still
waited for permission.
