/**
 * Built-in local tools for shell commands and managed command sessions.
 */
import type { Tool } from '@her-text/types'
import {
  interactCommandSession,
  listCommandSessions,
  resolveToolPath,
  runCommand,
  startCommandSession,
} from './local-node-ops.js'
import { createTool, truncateText } from './local-tool-factory.js'

export function createShellTools(): Tool[] {
  return [
    createBashTool(),
    createExecCommandTool(),
    createWriteStdinTool(),
    createListExecSessionsTool(),
  ]
}

function createBashTool(): Tool {
  return createTool({
    name: 'bash',
    description: 'Execute a shell command. Use for git/build/test/package commands; inspect scripts or docs before guessing. Do not use for ordinary file read/write/edit when dedicated tools fit.',
    safety: 'external',
    timeoutMs: 30000,
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The command to execute',
        },
        description: {
          type: 'string',
          description: 'Clear, concise description of what this command does (for logging and user feedback)',
        },
        cwd: {
          type: 'string',
          description: 'Working directory to execute the command in (defaults to current directory)',
        },
        timeout: {
          type: 'number',
          description: 'Optional timeout in milliseconds (max 600000ms / 10 minutes). Default: 120000',
          default: 120000,
        },
        run_in_background: {
          type: 'boolean',
          description: 'Set to true to run this command in the background',
          default: false,
        },
      },
      required: ['command'],
    },
    execute: async ({
      command,
      description,
      cwd,
      timeout = 120000,
      run_in_background = false,
    }) => {
      if (run_in_background) {
        const session = await startCommandSession(command, {
          cwd,
          yieldTimeMs: 1000,
          maxOutputChars: 12000,
        })
        return {
          success: true,
          result: {
            background: true,
            ...session,
            message: 'Command started in background',
          },
        }
      }

      const output = await runCommand(command, { cwd, timeout })
      return {
        success: output.exitCode === 0,
        result: {
          command,
          description,
          cwd: resolveToolPath(cwd),
          stdout: output.stdout,
          stderr: output.stderr,
          exit_code: output.exitCode,
        },
      }
    },
  })
}

function createExecCommandTool(): Tool {
  return createTool({
    name: 'exec_command',
    description: 'Run a shell command with work-tool-style arguments. Use background=true for long-running or interactive commands; it returns a session_id that write_stdin can continue, poll, or terminate.',
    safety: 'external',
    timeoutMs: 30000,
    parameters: {
      type: 'object',
      properties: {
        cmd: {
          type: 'string',
          description: 'Shell command to execute.',
        },
        workdir: {
          type: 'string',
          description: 'Working directory. Defaults to the current process working directory.',
        },
        timeout_ms: {
          type: 'number',
          description: 'Timeout in milliseconds. Defaults to 120000.',
          default: 120000,
        },
        max_output_chars: {
          type: 'number',
          description: 'Maximum stdout/stderr characters to return. Defaults to 12000.',
          default: 12000,
        },
        background: {
          type: 'boolean',
          description: 'Start a managed command session and return immediately. Use this for dev servers, watch tasks, REPLs, and interactive commands.',
          default: false,
        },
        yield_time_ms: {
          type: 'number',
          description: 'When background=true, wait this long before returning initial output. Defaults to 1000.',
          default: 1000,
        },
      },
      required: ['cmd'],
    },
    execute: async ({
      cmd,
      workdir,
      timeout_ms = 120000,
      max_output_chars = 12000,
      background = false,
      yield_time_ms = 1000,
    }) => {
      if (background) {
        const session = await startCommandSession(cmd, {
          cwd: workdir,
          yieldTimeMs: yield_time_ms,
          maxOutputChars: max_output_chars,
        })
        return {
          success: true,
          result: {
            background: true,
            ...session,
          },
        }
      }

      const output = await runCommand(cmd, { cwd: workdir, timeout: timeout_ms })
      return {
        success: output.exitCode === 0,
        result: {
          command: cmd,
          cwd: resolveToolPath(workdir),
          stdout: truncateText(output.stdout, max_output_chars),
          stderr: truncateText(output.stderr, max_output_chars),
          stdout_truncated: output.stdout.length > max_output_chars,
          stderr_truncated: output.stderr.length > max_output_chars,
          exit_code: output.exitCode,
          timed_out: Boolean(output.timedOut),
          duration_ms: output.durationMs,
        },
      }
    },
  })
}

function createWriteStdinTool(): Tool {
  return createTool({
    name: 'write_stdin',
    description: 'Continue a managed exec_command session: write stdin, poll recent output, or terminate it. Use this after exec_command returned a session_id.',
    safety: 'external',
    timeoutMs: 30000,
    parameters: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'The session_id returned by exec_command(background=true).',
        },
        chars: {
          type: 'string',
          description: 'Optional text to write to stdin. Omit or use an empty string to only poll output.',
        },
        yield_time_ms: {
          type: 'number',
          description: 'Wait this long before reading recent output. Defaults to 1000.',
          default: 1000,
        },
        max_output_chars: {
          type: 'number',
          description: 'Maximum stdout/stderr characters to return. Defaults to 12000.',
          default: 12000,
        },
        terminate: {
          type: 'boolean',
          description: 'Terminate the session after any stdin write.',
          default: false,
        },
        signal: {
          type: 'string',
          description: 'Signal to use when terminate=true. Defaults to SIGTERM.',
          default: 'SIGTERM',
        },
      },
      required: ['session_id'],
    },
    execute: async ({
      session_id,
      chars = '',
      yield_time_ms = 1000,
      max_output_chars = 12000,
      terminate = false,
      signal = 'SIGTERM',
    }) => {
      const result = await interactCommandSession(session_id, {
        chars,
        yieldTimeMs: yield_time_ms,
        maxOutputChars: max_output_chars,
        terminate,
        signal,
      })
      return {
        success: result.exit_code === 0 || result.running,
        result,
      }
    },
  })
}

function createListExecSessionsTool(): Tool {
  return createTool({
    name: 'list_exec_sessions',
    description: 'List managed exec_command sessions. Use this if you need to recover active session ids or inspect running command sessions.',
    safety: 'external',
    timeoutMs: 30000,
    parameters: {
      type: 'object',
      properties: {
        include_exited: {
          type: 'boolean',
          description: 'Include recently exited sessions. Defaults to false.',
          default: false,
        },
        max_output_chars: {
          type: 'number',
          description: 'Maximum stdout/stderr characters per session. Defaults to 2000.',
          default: 2000,
        },
      },
    },
    execute: async ({
      include_exited = false,
      max_output_chars = 2000,
    } = {}) => {
      const sessions = listCommandSessions({
        includeExited: include_exited,
        maxOutputChars: max_output_chars,
      })
      return {
        success: true,
        result: {
          sessions,
          count: sessions.length,
        },
      }
    },
  })
}
