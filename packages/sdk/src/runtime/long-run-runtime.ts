/**
 * Persists long-running goal runs on top of the work runtime.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { generateId } from '@her-text/core'

export type GoalRunDirection = 'minimize' | 'maximize' | 'target'
export type GoalRunStatus = 'initialized' | 'running' | 'paused' | 'completed' | 'needs_human' | 'failed'
export type GoalRunRollbackPolicy = 'checkpoint_only' | 'non_destructive_revert' | 'dedicated_worktree'

export interface GoalRun {
  id: string
  goal: string
  scope: string[]
  metric: string
  direction: GoalRunDirection
  verify: string
  guard: string
  iterations: GoalRunIteration[]
  stopCondition: string
  rollbackPolicy: GoalRunRollbackPolicy
  status: GoalRunStatus
  baseline: GoalRunMeasurement
  artifactDir: string
  createdAt: number
  updatedAt: number
}

export interface GoalRunMeasurement {
  metricValue: number
  measuredAt: number
  command?: string
}

export interface GoalRunIteration {
  index: number
  hypothesis: string
  metricValue: number
  guardPassed: boolean
  decision: 'keep' | 'discard' | 'needs_human'
  checkpoint?: string
  note?: string
  createdAt: number
}

export interface GoalRunIterationRequest {
  hypothesis: string
  applyFocusedChange: () => Promise<GoalRunCheckpoint>
  verify: () => Promise<GoalRunMeasurement>
  guard: () => Promise<GoalRunGuardResult>
}

export interface GoalRunCheckpoint {
  id: string
  description: string
}

export interface GoalRunGuardResult {
  passed: boolean
  output?: string
}

export interface CreateGoalRunRequest {
  goal: string
  scope: string[]
  metric: string
  direction: GoalRunDirection
  verify: string
  guard: string
  stopCondition: string
  rollbackPolicy: GoalRunRollbackPolicy
  artifactRoot: string
  baseline: GoalRunMeasurement
}

export class LongRunRuntime {
  async createRun(request: CreateGoalRunRequest): Promise<GoalRun> {
    if (!Number.isFinite(request.baseline.metricValue)) {
      throw new Error('Baseline metric must be measured before initializing a long run')
    }
    const now = Date.now()
    const run: GoalRun = {
      id: generateId(),
      goal: request.goal,
      scope: [...request.scope],
      metric: request.metric,
      direction: request.direction,
      verify: request.verify,
      guard: request.guard,
      iterations: [],
      stopCondition: request.stopCondition,
      rollbackPolicy: request.rollbackPolicy,
      status: 'initialized',
      baseline: { ...request.baseline },
      artifactDir: join(request.artifactRoot, 'long-runs', sanitizePathSegment(request.goal)),
      createdAt: now,
      updatedAt: now,
    }
    await this.initializeArtifacts(run)
    return run
  }

  async resumeRun(artifactDir: string): Promise<GoalRun> {
    const raw = await readFile(join(artifactDir, 'state.json'), 'utf8')
    return JSON.parse(raw) as GoalRun
  }

  async setStatus(run: GoalRun, status: GoalRunStatus): Promise<GoalRun> {
    const updated = { ...run, status, updatedAt: Date.now() }
    await this.writeState(updated)
    await this.appendRuntimeLog(updated, `status=${status}`)
    return updated
  }

  async recordIteration(run: GoalRun, iteration: Omit<GoalRunIteration, 'index' | 'createdAt'>): Promise<GoalRun> {
    const next: GoalRunIteration = {
      ...iteration,
      index: run.iterations.length + 1,
      createdAt: Date.now(),
    }
    const updated: GoalRun = {
      ...run,
      iterations: [...run.iterations, next],
      updatedAt: Date.now(),
    }
    await appendFile(join(run.artifactDir, 'results.tsv'), formatIterationRow(next), 'utf8')
    await this.writeState(updated)
    await this.appendRuntimeLog(updated, `iteration=${next.index} decision=${next.decision} metric=${next.metricValue}`)
    return updated
  }

  async runIteration(run: GoalRun, request: GoalRunIterationRequest): Promise<GoalRun> {
    await this.appendRuntimeLog(run, `hypothesis=${request.hypothesis}`)
    const checkpoint = await request.applyFocusedChange()
    await this.appendRuntimeLog(run, `checkpoint=${checkpoint.id}`)
    const measurement = await request.verify()
    const guard = await request.guard()
    const decision = this.chooseDecision(run, measurement.metricValue, guard.passed)
    return this.recordIteration(run, {
      hypothesis: request.hypothesis,
      metricValue: measurement.metricValue,
      guardPassed: guard.passed,
      decision,
      checkpoint: checkpoint.id,
      note: checkpoint.description,
    })
  }

  async appendLesson(run: GoalRun, lesson: string): Promise<void> {
    await appendFile(join(run.artifactDir, 'lessons.md'), `\n- ${lesson}\n`, 'utf8')
  }

  private async initializeArtifacts(run: GoalRun): Promise<void> {
    await mkdir(run.artifactDir, { recursive: true })
    await writeFile(join(run.artifactDir, 'results.tsv'), 'iteration\thypothesis\tmetric\tguard\tdecision\tcheckpoint\tnote\n', 'utf8')
    await writeFile(join(run.artifactDir, 'lessons.md'), `# Lessons\n\nGoal: ${run.goal}\n`, 'utf8')
    await writeFile(join(run.artifactDir, 'runtime.log'), `initialized baseline=${run.baseline.metricValue}\n`, 'utf8')
    await this.writeState(run)
  }

  private async writeState(run: GoalRun): Promise<void> {
    await writeFile(join(run.artifactDir, 'state.json'), `${JSON.stringify(run, null, 2)}\n`, 'utf8')
  }

  private async appendRuntimeLog(run: GoalRun, line: string): Promise<void> {
    await appendFile(join(run.artifactDir, 'runtime.log'), `${new Date().toISOString()} ${line}\n`, 'utf8')
  }

  private chooseDecision(run: GoalRun, metricValue: number, guardPassed: boolean): GoalRunIteration['decision'] {
    if (!guardPassed) {
      return 'discard'
    }
    const previous = run.iterations.at(-1)?.metricValue ?? run.baseline.metricValue
    if (run.direction === 'maximize') {
      return metricValue >= previous ? 'keep' : 'discard'
    }
    if (run.direction === 'minimize') {
      return metricValue <= previous ? 'keep' : 'discard'
    }
    return metricValue === previous ? 'keep' : 'discard'
  }
}

function formatIterationRow(iteration: GoalRunIteration): string {
  return [
    iteration.index,
    escapeTsv(iteration.hypothesis),
    iteration.metricValue,
    iteration.guardPassed ? 'pass' : 'fail',
    iteration.decision,
    escapeTsv(iteration.checkpoint ?? ''),
    escapeTsv(iteration.note ?? ''),
  ].join('\t') + '\n'
}

function escapeTsv(value: string): string {
  return value.replace(/\t/g, ' ').replace(/\r?\n/g, ' ')
}

function sanitizePathSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'goal-run'
}
