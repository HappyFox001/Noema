/**
 * Built-in work tool strategy for task execution.
 *
 * Keeps tool selection deterministic and close to the runtime loop instead of
 * outsourcing core execution policy to plugin hints.
 */
import type { Tool } from '@her-text/types'
import { isDeferredTool } from './tool-discovery.js'

export function renderWorkToolStrategy(options: {
  tools: Tool[]
  deferredToolSummary?: string
}): string {
  const available = summarizeTools(options.tools)
  const capabilities = inferCapabilities(options.tools)

  return [
    '<tool_strategy>',
    'Execution model:',
    '- Keep working until the user goal is actually resolved, blocked by missing user input, or cancelled.',
    '- Read or observe enough context before acting; do not guess the environment, file contents, UI state, or command result.',
    '- Make the smallest change that can satisfy the current step. Avoid broad rewrites unless the task requires them.',
    '- After every external action, inspect the result and decide the next step from evidence.',
    '- Before marking a step completed, record concrete evidence in update_task_plan.result.',
    '',
    'Tool selection:',
    '- Locate before reading: use grep/glob or shell search for unknown files, symbols, settings, and scripts.',
    '- Read before editing existing files. If an edit or patch fails, read nearby context and retry with a smaller exact change.',
    '- Prefer apply_patch or exact edit for targeted source changes. Use write only for new files or full-file replacement.',
    '- Use bash/exec_command for git, package scripts, builds, tests, filesystem checks, and commands without dedicated tools.',
    '- Use exec_command background sessions for dev servers, watch processes, long-running commands, and interactive shells; use write_stdin to poll, send input, or terminate.',
    '- Use browser tools for URLs and DOM/browser state. Use desktop/computer observe tools for visual desktop state.',
    '- Use view_image or visual observe tools before making claims about screenshots, UI rendering, or images.',
    '- Use tool_search only when a needed capability is deferred or missing from visible tools; do not use it for ordinary file search.',
    '',
    'Verification policy:',
    '- File creation or edits require a file existence/read check or a relevant build/test/lint command.',
    '- Browser tasks require URL, title, DOM, or visual confirmation after navigation or interaction.',
    '- Desktop UI tasks require an observe step after actions that should change the screen.',
    '- Code changes require the narrowest useful verification command available. Prefer targeted checks before full suites.',
    '- If verification is impossible, say why in update_task_plan.result or error and do not pretend certainty.',
    '',
    'Failure and replanning:',
    '- Classify failures before retrying: missing path, permission, command not found, dependency missing, network, timeout, UI not ready, bad arguments, or insufficient user input.',
    '- Do not repeat the same tool call with the same arguments after it fails or returns no new information. Change the approach or update the plan.',
    '- After two weak/no-information attempts on the same step, replan or ask for required user input.',
    '- Never hide partial side effects. If a command created, changed, or deleted something, carry that fact forward.',
    '',
    'Planning discipline:',
    '- Keep one running step at a time.',
    '- Use update_task_plan when a step is completed, failed, skipped, or when evidence changes the plan.',
    '- Append new steps only when they are necessary; include the reason.',
    '- Final answers are allowed only after the plan is complete or the task is truly blocked.',
    '',
    capabilities.length > 0 ? `Detected capabilities:\n${capabilities.map(item => `- ${item}`).join('\n')}` : '',
    available.length > 0 ? `Visible tools:\n${available.map(item => `- ${item}`).join('\n')}` : '',
    options.deferredToolSummary ? `Deferred tools available through tool_search:\n${options.deferredToolSummary}` : '',
    '</tool_strategy>'
  ].filter(Boolean).join('\n')
}

function summarizeTools(tools: Tool[]): string[] {
  return tools
    .filter(tool => !isDeferredTool(tool))
    .map(tool => `${tool.name}: ${cleanOneLine(tool.description)}`)
    .slice(0, 24)
}

function inferCapabilities(tools: Tool[]): string[] {
  const names = new Set(tools.map(tool => tool.name))
  const capabilities: string[] = []

  if (hasAny(names, ['grep', 'glob', 'read'])) {
    capabilities.push('project/file context discovery')
  }
  if (hasAny(names, ['apply_patch', 'edit', 'write'])) {
    capabilities.push('targeted local file modification')
  }
  if (hasAny(names, ['bash', 'exec_command'])) {
    capabilities.push('shell commands, builds, tests, and verification')
  }
  if (hasAny(names, ['write_stdin', 'list_exec_sessions'])) {
    capabilities.push('managed long-running command sessions')
  }
  if (hasAny(names, ['browser_open', 'browser_observe', 'browser_click', 'browser_type'])) {
    capabilities.push('browser navigation and interaction')
  }
  if (hasAny(names, ['computer_observe', 'computer_click', 'computer_type', 'computer_wait'])) {
    capabilities.push('desktop visual control')
  }
  if (names.has('view_image')) {
    capabilities.push('local image inspection')
  }
  if (tools.some(isDeferredTool)) {
    capabilities.push('deferred capability discovery')
  }

  return capabilities
}

function hasAny(values: Set<string>, candidates: string[]): boolean {
  return candidates.some(candidate => values.has(candidate))
}

function cleanOneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 180)
}
