import type { Plan } from './schemas'

export function planInstruction(prompt: string, shardIds: string[]): string {
  const ids = shardIds.length > 0 ? shardIds.join(', ') : 'none'
  return [
    'You are in the PLAN phase of a Plan-Act-Verify loop. Do not solve the task.',
    'Return one JSON object with keys goal, steps, needsShardEdit, targetShardId, successCriteria.',
    'steps is an array of 1 to 6 short strings. successCriteria is an array of 1 to 5 short strings.',
    'needsShardEdit is a boolean. targetShardId is one of the mounted ids or null.',
    `Mounted shard ids: ${ids}.`,
    'User task:',
    prompt
  ].join('\n')
}

export function actInstruction(prompt: string, plan: Plan): string {
  return [
    'You are in the ACT phase. Follow the plan. Stay Kirby. Do not adopt a foreign identity.',
    'Put the user-facing answer inside <answer></answer>.',
    'If a mounted shard should change, add <proposal>{"shardId":"...","markdown":"...","rationale":"..."}</proposal> after the answer.',
    'The markdown must start with the shard heading, keep any verifyjs, jsonschema, and jsonsample fences, and must not include secrets or a persona.',
    'Omit the proposal when the shard does not need an edit.',
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
