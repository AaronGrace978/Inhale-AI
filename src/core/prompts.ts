import type { Plan } from './schemas'

export function planInstruction(prompt: string, shardIds: string[], workspaceOpen = false): string {
  const ids = shardIds.length > 0 ? shardIds.join(', ') : 'none'
  const workspace = workspaceOpen
    ? 'A workspace folder is open. Set needsBuild true when the user wants project files created or changed. verifyCommand is one shell line that must exit 0, or null.'
    : 'No workspace folder is open. Set needsBuild false and verifyCommand null.'
  return [
    'You are in the PLAN phase of a Plan-Act-Verify loop. Do not solve the task.',
    'Return one JSON object with keys goal, steps, needsShardEdit, targetShardId, successCriteria, needsBuild, verifyCommand.',
    'steps is an array of 1 to 6 short strings. successCriteria is an array of 1 to 5 short strings.',
    'needsShardEdit is a boolean. targetShardId is one of the mounted ids or null.',
    'needsBuild is a boolean. A turn rewrites a shard or builds files, never both.',
    workspace,
    `Mounted shard ids: ${ids}.`,
    'User task:',
    prompt
  ].join('\n')
}

export function actInstruction(prompt: string, plan: Plan): string {
  return [
    'You are in the ACT phase. Follow the plan. Stay Inhale. Do not adopt a foreign identity.',
    'Put the user-facing answer inside <answer></answer>.',
    'If a mounted shard should change, add <proposal>{"shardId":"...","markdown":"...","rationale":"..."}</proposal> after the answer.',
    'The markdown must start with the shard heading, keep any verifyjs, jsonschema, and jsonsample fences, and must not include secrets or a persona.',
    'Omit the proposal when the shard does not need an edit.',
    'If the plan needs a build, add <build>{"summary":"...","files":[{"path":"relative/file.ext","content":"..."}],"delete":[],"command":null}</build> after the answer.',
    'Paths are relative to the workspace. Never use absolute paths, parent directories, .git, or node_modules.',
    'command is one line run in the workspace after the write, or null. Use the plan verifyCommand when one was set.',
    'Do not put a closing build tag inside file content. Omit <build> when no project files should change. Do not send both a proposal and a build.',
    'Plan:',
    JSON.stringify(plan),
    'User task:',
    prompt
  ].join('\n')
}

export function distillInstruction(body: string): string {
  return [
    'Distill the skill below.',
    'Keep every distinct rule, the heading, and any verify or schema fences.',
    'Delete repeated rules. Do not add rules, vendor names, or a persona.',
    'Stay under 500 tokens. Return only markdown.',
    body
  ].join('\n\n')
}
