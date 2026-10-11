# Agent team

Five opencode agents that work as a team. You talk to the lead, and the lead hands the work to the others and only
reports done once the change is tested, reviewed and audited.

| Agent | Job | Can edit |
| --- | --- | --- |
| `team-lead` | Plans, delegates and checks everyone's work | Asks first |
| `team-coder` | Writes the code | Yes |
| `team-tester` | Writes and runs tests and tries to break the code | Test files only |
| `team-reviewer` | Reviews for bugs and fit with the codebase | No |
| `team-auditor` | Audits for security and privacy problems | No |

The tester, reviewer and auditor cannot change the code they check, so their findings have to go back through the
lead and the coder. That keeps the checks independent.

## Install

Copy the files in `agents/` to `~/.config/opencode/agents/` on the computer that runs opencode, for every project,
or to a project's `.opencode/agents/` for that project only. On Windows the global folder is
`%USERPROFILE%\.config\opencode\agents\`.

Then pick **team-lead** as the agent in the app or the TUI and describe what you want built.

## Models

The agents don't name a model, so they use whatever model you pick, including OpenCode Go models. To give one a
different model, add a `model:` line to its file, for example `model: opencode-go/kimi-k3`. `/models` lists the
exact names.

## Make your own team

Copy a file, rename it (the file name is the agent's name), change the `description` and the prompt, and add it to
the lead's list of teammates. Any agent whose name starts with `team-` can be called by the lead.
