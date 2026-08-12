import type { Depth } from './config';
import type { ResearchSourceType, ResearchTool } from './profiles';

/**
 * ResearchPlanner — turns an objective + the user-selected source scope into a
 * BOUNDED, acyclic task plan. It is TRUSTED server logic: source content can never
 * add or modify tasks (only the orchestrator plans). The plan is concise + user-
 * facing (areas + questions), NOT hidden reasoning.
 */

export interface TaskSpec {
  title: string;
  objective: string;
  taskType: 'WEB_RESEARCH' | 'PRIVATE_KNOWLEDGE_RESEARCH' | 'CONNECTED_DATA_RESEARCH' | 'DOCUMENT_ANALYSIS' | 'COMPARISON' | 'VERIFICATION' | 'SYNTHESIS_SUPPORT';
  profile: string;
  allowedTools: ResearchTool[];
  allowedSourceTypes: ResearchSourceType[];
  scope: string;
  /** Indices (into the tasks array) this task depends on. Must form a DAG. */
  dependsOn: number[];
}

export interface ResearchPlan {
  questions: string[];
  areas: string[];
  tasks: TaskSpec[];
}

/** Split an objective into a few bounded sub-questions (deterministic heuristic). */
function subQuestions(objective: string): string[] {
  const parts = objective
    .split(/\band\b|,|;|\bthen\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 8)
    .slice(0, 4);
  return parts.length ? parts.map((p) => (p.endsWith('?') ? p : `${p}?`)) : [objective.endsWith('?') ? objective : `${objective}?`];
}

export function buildPlan(input: { objective: string; depth: Depth; maxTasks: number; webEnabled: boolean; hasKnowledgeBases: boolean; hasConnections: boolean }): ResearchPlan {
  const tasks: TaskSpec[] = [];
  const retrievalIdx: number[] = [];
  const q = input.objective;

  if (input.webEnabled) {
    tasks.push({ title: 'Public web research', objective: `Gather current public information about: ${q}`, taskType: 'WEB_RESEARCH', profile: 'web-researcher', allowedTools: ['web.search', 'web.fetch'], allowedSourceTypes: ['PUBLIC_WEB', 'PRIMARY_OFFICIAL_SOURCE'], scope: 'Public web and primary sources only. No private data.', dependsOn: [] });
    retrievalIdx.push(tasks.length - 1);
  }
  if (input.hasKnowledgeBases) {
    tasks.push({ title: 'Internal knowledge research', objective: `Find relevant internal material for: ${q}`, taskType: 'PRIVATE_KNOWLEDGE_RESEARCH', profile: 'internal-knowledge-analyst', allowedTools: ['rag.retrieve'], allowedSourceTypes: ['KNOWLEDGE_BASE', 'PRIVATE_DOCUMENT'], scope: 'Only the authorized knowledge bases selected for this run.', dependsOn: [] });
    retrievalIdx.push(tasks.length - 1);
  }
  if (input.hasConnections) {
    tasks.push({ title: 'Connected data research', objective: `Find relevant connected-app material for: ${q}`, taskType: 'CONNECTED_DATA_RESEARCH', profile: 'connected-data-analyst', allowedTools: ['connected.search'], allowedSourceTypes: ['CONNECTED_EMAIL', 'CONNECTED_FILE', 'CONNECTED_MESSAGE', 'CONNECTED_RECORD'], scope: 'Only the connections explicitly selected for this run.', dependsOn: [] });
    retrievalIdx.push(tasks.length - 1);
  }

  // A verification/comparison stage over the collected evidence.
  if (retrievalIdx.length && tasks.length < input.maxTasks - 1) {
    tasks.push({ title: 'Verify key claims', objective: 'Check important claims against the collected evidence and flag conflicts.', taskType: 'VERIFICATION', profile: 'fact-checker', allowedTools: ['verify', 'web.search'], allowedSourceTypes: ['PUBLIC_WEB', 'PRIMARY_OFFICIAL_SOURCE'], scope: 'Verify claims already surfaced. Do not open new research areas.', dependsOn: [...retrievalIdx] });
  }

  // Synthesis always last, depending on everything before it.
  const beforeSynthesis = tasks.map((_, i) => i);
  tasks.push({ title: 'Synthesize findings', objective: `Synthesize the verified findings into an evidence-based answer to: ${q}`, taskType: 'SYNTHESIS_SUPPORT', profile: 'synthesis-analyst', allowedTools: ['synthesize'], allowedSourceTypes: [], scope: 'Operate only on verified findings + evidence. Do not invent facts.', dependsOn: beforeSynthesis });

  // Enforce the task ceiling (keep synthesis; trim middle if needed).
  const trimmed = tasks.length > input.maxTasks ? [...tasks.slice(0, input.maxTasks - 1), tasks[tasks.length - 1]] : tasks;

  return { questions: subQuestions(q), areas: trimmed.filter((t) => t.taskType !== 'SYNTHESIS_SUPPORT' && t.taskType !== 'VERIFICATION').map((t) => t.title), tasks: trimmed };
}

/** Reject any plan whose dependency edges contain a cycle (defensive DAG check). */
export function isAcyclic(tasks: TaskSpec[]): boolean {
  const state = new Array(tasks.length).fill(0); // 0=unvisited 1=visiting 2=done
  const dfs = (i: number): boolean => {
    if (state[i] === 1) return false; // back-edge → cycle
    if (state[i] === 2) return true;
    state[i] = 1;
    for (const d of tasks[i].dependsOn) {
      if (d < 0 || d >= tasks.length || d === i) return false;
      if (!dfs(d)) return false;
    }
    state[i] = 2;
    return true;
  };
  return tasks.every((_, i) => dfs(i));
}
