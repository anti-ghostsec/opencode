// opencode autopilot: keeps agents working while you are away.
//
// Turn it on in a session with `/autopilot <task>` (or pick any agent whose
// name contains "autopilot"). While it is on:
//   - every time the agent stops, it is prompted to continue, until it ends a
//     reply with AUTOPILOT DONE or a round limit is reached;
//   - it never waits on you: the question tool is removed, and permission
//     prompts are approved automatically, except risky commands and edits
//     outside the project, which are refused with a note instead;
//   - a turn that hangs with no activity is interrupted and restarted;
//   - failed turns (rate limits, network) are retried with backoff.
// `/autopilot off` stops it. Stopping a turn yourself also stops it.
//
// Install: copy this file to ~/.config/opencode/plugins/ (Windows:
// %USERPROFILE%\.config\opencode\plugins\) and restart opencode.
// No dependencies; a plain default export is all the plugin loader needs.

const DONE = "AUTOPILOT DONE"

const DEFAULTS = {
  // Most continue prompts per task before autopilot gives up.
  maxRounds: 200,
  // Seconds to wait after a turn ends before prompting it to continue.
  delay: 10,
  // Minutes of silence in a running turn before it is interrupted and restarted.
  stallMinutes: 30,
  // Consecutive failed turns before autopilot gives up.
  maxFailures: 8,
  // Allow edits outside the project directory.
  allowExternal: false,
}

const CONTINUE = `<system-reminder>
Autopilot: the user is away. Continue the task.
- If you were waiting on something (a build, tests, a server, a download), check its status yourself now and act on the result.
- If you offered the user a choice, take the recommended option (or the safest reasonable one) yourself, say in one line what you picked, and do it.
- If something failed, diagnose it and try another approach.
When the whole task is finished and verified, end your reply with the line ${DONE}.
</system-reminder>`

const RULES = `<system-reminder>
Autopilot is on. The user is away and cannot answer questions or approve anything.
- Never ask the user a question or wait for their reply. Whenever you would ask, choose the recommended or safest reasonable option yourself, state the decision in one line, and keep going.
- Never end a turn just to wait. If something is running, poll it (for example with a short sleep followed by a status check) until it finishes, then continue.
- Keep a short running log of decisions you made on the user's behalf so they can review them later.
- Ordinary permission requests are approved automatically. Risky actions (force pushes, hard resets, deleting outside the project, sudo, publishing, global installs) are refused; do not retry them. Find a safer way, or list them under "Needs your approval" in your final summary.
- When the whole task is finished and verified, end your final reply with the line ${DONE}. Do not write that line before then.
</system-reminder>`

const CHILD_RULES = `<system-reminder>
Autopilot is on and the user is away. Never ask the user questions; choose the recommended or safest reasonable option yourself and note the decision in your result. Finish your assigned work before returning.
</system-reminder>`

// Shell commands refused under autopilot instead of being approved.
const RISKY = [
  /\bgit\s+push\b.*(\s-f\b|\s--force\b|\s--force-with-lease\b|\s\+\S)/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-\S*f/i,
  /\bgit\s+(branch\s+-D|push\s+\S+\s+--delete|push\s+\S+\s+:)/i,
  /\brm\s+(-\S*\s+)*(\/|~|\$HOME|\.\.)(\s|\/?$|\/\*)/i,
  /\brm\s+-\S*r\S*\s+(-\S+\s+)*\/(\S*)?(\s|$)/i,
  /\b(rm|remove-item|del|rd|rmdir)\b.*\s["']?\.\.([\\/]|\s|$)/i,
  /\b(sudo|doas|runas)\b/i,
  /\b(mkfs|fdisk|diskpart|format(\.com)?\s+[a-z]:|shutdown|reboot|halt|poweroff)\b/i,
  /\bdd\s+.*\bof=\/dev\//i,
  /\b(remove-item|rm|del|rd|rmdir)\b.*\s([a-z]:\\?|\\\\|%userprofile%|\$env:userprofile|~)(\\|\/)?(\s|$|\*)/i,
  /\b(rd|rmdir)\s+\/s\b.*\b[a-z]:\\/i,
  /\breg(\.exe)?\s+(delete|add)\b/i,
  /\b(set-executionpolicy|bcdedit|vssadmin|cipher\s+\/w)\b/i,
  /\b(curl|wget|iwr|invoke-webrequest|irm|invoke-restmethod)\b.*\|\s*(sh|bash|zsh|iex|invoke-expression|python\S*|node|pwsh|powershell)\b/i,
  /\b(npm|pnpm|yarn|bun)\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b|\bgh\s+release\s+create\b/i,
  /\b(npm|pnpm|yarn|bun)\s+(i|install|add)\s+(-g|--global)\b/i,
  /\bchmod\s+-R\s+777\b/i,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
]

const risky = (command) => RISKY.some((pattern) => pattern.test(command))

const payload = (event) => event?.data ?? event?.properties ?? event ?? {}

export default {
  id: "autopilot",
  setup: async (ctx) => {
    const options = { ...DEFAULTS, ...(ctx.options ?? {}) }
    const controller = new AbortController()

    // Root sessions with autopilot on: sessionID -> state
    const active = new Map()
    // Sessions explicitly turned off, so an autopilot agent does not re-enable them.
    const disabled = new Set()
    // sessionID -> parentID (null for roots), cached from session.get
    const parents = new Map()
    // sessionID -> agent id
    const agents = new Map()
    // Sessions with an execution in progress.
    const running = new Set()

    const log = (...args) => console.log("[autopilot]", ...args)

    const info = async (sessionID) => {
      if (parents.has(sessionID)) return
      try {
        const session = await ctx.session.get({ sessionID })
        parents.set(sessionID, session.parentID ?? null)
        if (session.agent) agents.set(sessionID, String(session.agent))
      } catch {
        parents.set(sessionID, null)
      }
    }

    const rootOf = async (sessionID) => {
      let current = sessionID
      for (let depth = 0; depth < 20; depth++) {
        await info(current)
        const parent = parents.get(current)
        if (!parent) return current
        current = parent
      }
      return current
    }

    const isAutopilotAgent = (sessionID) => /autopilot/i.test(agents.get(sessionID) ?? "")

    const enable = (sessionID, reason) => {
      disabled.delete(sessionID)
      if (active.has(sessionID)) return active.get(sessionID)
      const state = { rounds: 0, failures: 0, timer: undefined, lastText: "", lastActivity: Date.now() }
      active.set(sessionID, state)
      log("on", sessionID, reason)
      return state
    }

    const disable = (sessionID, reason) => {
      const state = active.get(sessionID)
      if (state?.timer) clearTimeout(state.timer)
      active.delete(sessionID)
      disabled.add(sessionID)
      if (state) log("off", sessionID, reason)
    }

    // Autopilot state for the root of this session, enabling it for autopilot agents.
    const stateFor = async (sessionID) => {
      const root = await rootOf(sessionID)
      if (active.has(root)) return { root, state: active.get(root) }
      if (!disabled.has(root) && isAutopilotAgent(root)) return { root, state: enable(root, "autopilot agent") }
      return { root, state: undefined }
    }

    const descends = (sessionID, root) => {
      let current = sessionID
      for (let depth = 0; depth < 20 && current; depth++) {
        if (current === root) return true
        current = parents.get(current) ?? null
      }
      return false
    }

    // True while the root or any of its subagents is still running.
    const busy = (root) => [...running].some((id) => descends(id, root))

    const schedule = (root, seconds) => {
      const state = active.get(root)
      if (!state) return
      if (state.timer) clearTimeout(state.timer)
      state.timer = setTimeout(() => {
        state.timer = undefined
        state.restarting = false
        void nudge(root)
      }, seconds * 1000)
    }

    const nudge = async (root) => {
      const state = active.get(root)
      if (!state || busy(root)) return
      if (state.rounds >= options.maxRounds) {
        disable(root, `reached ${options.maxRounds} rounds`)
        return
      }
      state.rounds++
      state.lastActivity = Date.now()
      log("continue", root, `round ${state.rounds}`)
      try {
        await ctx.session.prompt({ sessionID: root, text: CONTINUE, delivery: "queue" })
      } catch (error) {
        log("continue failed", root, error?.message ?? error)
        state.failures++
        if (state.failures >= options.maxFailures) disable(root, "could not send continue prompt")
        else schedule(root, Math.min(600, options.delay * 2 ** state.failures))
      }
    }

    const finished = async (sessionID) => {
      running.delete(sessionID)
      const { root, state } = await stateFor(sessionID)
      if (!state) return
      if (sessionID === root && state.lastText.trimEnd().endsWith(DONE)) {
        disable(root, "task done")
        return
      }
      if (busy(root)) return
      schedule(root, options.delay)
    }

    // Commands: /autopilot <task>, /autopilot off, /autopilot status
    await ctx.command.transform((editor) => {
      editor.add({
        name: "autopilot",
        description: "keep working without me: /autopilot <task>, /autopilot off",
        execute: async (input) => {
          const text = (input.prompt?.text ?? "").trim()
          const root = await rootOf(input.sessionID)
          if (/^(off|stop|disable)$/i.test(text)) {
            disable(root, "user turned it off")
            await ctx.session
              .synthetic({ sessionID: root, text: "Autopilot is off.", resume: false })
              .catch(() => {})
            return
          }
          if (/^status$/i.test(text)) {
            const state = active.get(root)
            await ctx.session
              .synthetic({
                sessionID: root,
                text: state ? `Autopilot is on (round ${state.rounds} of ${options.maxRounds}).` : "Autopilot is off.",
                resume: false,
              })
              .catch(() => {})
            return
          }
          const state = enable(root, "command")
          state.rounds = 0
          state.failures = 0
          await ctx.session.prompt({
            ...input.prompt,
            sessionID: root,
            text: text || CONTINUE,
            delivery: input.delivery,
          })
        },
      })
    })

    // Hide the question tool and add the autopilot rules to every request.
    await ctx.session.hook("context", async (event) => {
      const { root, state } = await stateFor(event.sessionID)
      if (!state) return
      delete event.tools.question
      event.system.push({ type: "text", text: event.sessionID === root ? RULES : CHILD_RULES })
    })

    // Answer permission prompts so nothing waits on the user. Ordinary requests are
    // approved; risky shell commands and work outside the project are refused with a note.
    await ctx.permission.hook("evaluate", async (event) => {
      if (event.effect !== "ask") return
      const { state } = await stateFor(event.sessionID)
      if (!state) return
      if (event.action === "question") {
        event.effect = "deny"
        event.message =
          "Autopilot: the user is away and cannot answer. Choose the recommended option yourself, state the decision in one line, and continue."
        return
      }
      if (event.action === "doom_loop") {
        event.effect = "deny"
        event.message = "Autopilot: you are repeating the same call. Stop and try a different approach."
        return
      }
      if (event.action === "external_directory" && !options.allowExternal) {
        event.effect = "deny"
        event.message =
          "Autopilot: work outside the project directory is not allowed while the user is away. Skip it and list it under 'Needs your approval' in your final summary."
        return
      }
      if ((event.action === "shell" || event.action === "bash") && event.resources.some(risky)) {
        event.effect = "deny"
        event.message =
          "Autopilot refused this command because it is risky to run unattended. Do not retry it. Find a safer way, or list it under 'Needs your approval' in your final summary and continue with other work."
        log("refused", event.resources.join(" ; "))
        return
      }
      event.effect = "allow"
    })

    // Watch session activity.
    const watch = async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        const type = event?.type
        if (typeof type !== "string" || !type.startsWith("session.")) continue
        const data = payload(event)
        const sessionID = data.sessionID
        if (!sessionID) continue
        try {
          if (type === "session.agent.selected") {
            const agent = data.agent ?? data.agentID
            if (agent) agents.set(sessionID, String(agent))
            continue
          }
          if (type === "session.deleted") {
            disable(sessionID, "session deleted")
            disabled.delete(sessionID)
            continue
          }
          const root = await rootOf(sessionID)
          const state = active.get(root)
          if (state) state.lastActivity = Date.now()
          if (type === "session.execution.started") {
            running.add(sessionID)
            if (state?.timer) {
              clearTimeout(state.timer)
              state.timer = undefined
            }
            if (state && sessionID === root) state.lastText = ""
            continue
          }
          if (type === "session.text.ended") {
            if (state && sessionID === root && typeof data.text === "string" && data.text.trim())
              state.lastText = data.text
            continue
          }
          if (type === "session.execution.succeeded") {
            if (state && sessionID === root) state.failures = 0
            await finished(sessionID)
            continue
          }
          if (type === "session.execution.failed") {
            running.delete(sessionID)
            const current = await stateFor(sessionID)
            if (!current.state) continue
            if (sessionID !== current.root) {
              await finished(sessionID)
              continue
            }
            current.state.failures++
            log("turn failed", root, data.error?.message ?? "")
            if (current.state.failures >= options.maxFailures) disable(root, "too many failures")
            else schedule(root, Math.min(600, options.delay * 2 ** current.state.failures))
            continue
          }
          if (type === "session.execution.interrupted") {
            running.delete(sessionID)
            // You pressed stop: respect it and turn autopilot off for that task.
            if (data.reason === "user" && sessionID === root && !state?.restarting) {
              disable(root, "stopped by user")
              continue
            }
            if (data.reason === "shutdown") continue
            if (state?.restarting) continue
            await finished(sessionID)
          }
        } catch (error) {
          log("event error", type, error?.message ?? error)
        }
      }
    }
    void watch().catch((error) => {
      if (!controller.signal.aborted) log("event stream ended", error?.message ?? error)
    })

    // Restart turns that have gone silent.
    const watchdog = setInterval(() => {
      const now = Date.now()
      for (const [root, state] of active) {
        if (!busy(root)) continue
        if (now - state.lastActivity < options.stallMinutes * 60_000) continue
        state.lastActivity = now
        state.restarting = true
        log("stalled, interrupting", root)
        void ctx.session
          .interrupt({ sessionID: root })
          .catch((error) => log("interrupt failed", error?.message ?? error))
          .finally(() => {
            for (const id of [...running]) if (descends(id, root)) running.delete(id)
            schedule(root, options.delay)
          })
      }
    }, 60_000)

    return () => {
      controller.abort()
      clearInterval(watchdog)
      for (const [, state] of active) if (state.timer) clearTimeout(state.timer)
    }
  },
}
