import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

const readJson = (...parts) => JSON.parse(readFileSync(join(dataDir, ...parts), 'utf8'));

/**
 * Paths are stored one file per career path so each stays reviewable by hand.
 * Display order is fixed here rather than by filename, because the order is a
 * product decision — gentlest, most reachable paths first.
 */
const PATH_ORDER = [
  'it-support',
  'qa-testing',
  'it-project-coordination',
  'technical-business-analyst',
  'data-analytics',
  'networking',
  'ux-ui-design',
  'cloud-devops',
  'cybersecurity',
  'database-admin',
  'software-engineering',
];

function loadPaths() {
  const files = readdirSync(join(dataDir, 'paths')).filter((f) => f.endsWith('.json'));
  const byId = new Map();

  for (const file of files) {
    const path = readJson('paths', file);
    if (byId.has(path.id)) throw new Error(`Duplicate path id: ${path.id}`);
    byId.set(path.id, decorate(path));
  }

  const ordered = PATH_ORDER.filter((id) => byId.has(id)).map((id) => byId.get(id));
  const unlisted = [...byId.values()].filter((p) => !PATH_ORDER.includes(p.id));
  return [...ordered, ...unlisted];
}

/** Derived per-path totals, computed once at load so no client has to. */
function decorate(path) {
  const required = path.steps.filter((s) => !s.optional);
  const sum = (steps, key) => steps.reduce((total, s) => total + (s[key] || 0), 0);

  return {
    ...path,
    totals: {
      steps: path.steps.length,
      requiredSteps: required.length,
      requiredHours: sum(required, 'estimatedHours'),
      totalHours: sum(path.steps, 'estimatedHours'),
      requiredWeeks: sum(required, 'estimatedWeeks'),
      requiredCost: sum(required, 'costEstimate'),
      totalCost: sum(path.steps, 'costEstimate'),
      freeSteps: path.steps.filter((s) => !s.costEstimate).length,
      noPcSteps: path.steps.filter((s) => s.noPcRequired).length,
      projectSteps: path.steps.filter((s) => s.type === 'project').length,
      certSteps: path.steps.filter((s) => s.type === 'certification').length,
    },
  };
}

const paths = loadPaths();
const quiz = readJson('quiz.json');
const badges = readJson('badges.json');

const stepIndex = new Map();
for (const path of paths) {
  for (const step of path.steps) {
    if (stepIndex.has(step.id)) throw new Error(`Duplicate step id: ${step.id}`);
    stepIndex.set(step.id, { step, pathId: path.id, pathName: path.name });
  }
}

// Content is static per deploy; the hash lets offline clients tell whether the
// copy in their cache is still current without downloading the whole payload.
const version = createHash('sha256')
  .update(JSON.stringify({ paths, quiz, badges }))
  .digest('hex')
  .slice(0, 12);

export const content = { paths, quiz, badges, version };
export const getStep = (stepId) => stepIndex.get(stepId);
export const getPath = (pathId) => paths.find((p) => p.id === pathId);
export const allStepIds = () => [...stepIndex.keys()];
