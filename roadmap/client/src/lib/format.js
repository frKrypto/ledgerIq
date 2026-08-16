/** Prices: zero means the thing is free, which is worth saying out loud. */
export const money = (value) =>
  value === 0 ? 'Free' : `$${Math.round(value).toLocaleString('en-US')}`;

/** Amounts of money spent, where zero is a number rather than a claim. */
export const dollars = (value) => `$${Math.round(value).toLocaleString('en-US')}`;

export const salary = (range) =>
  `$${Math.round(range.min / 1000)}K–$${Math.round(range.max / 1000)}K`;

export const hours = (value) => `${Math.round(value * 10) / 10}h`;

export function relativeDate(iso) {
  if (!iso) return 'never';
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  return `${Math.round(days / 365)} years ago`;
}

export const shortDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

export const STEP_TYPE_LABEL = {
  skill: 'Skill',
  certification: 'Certification',
  project: 'Project',
  experience: 'Experience',
};

/**
 * Filter predicate shared by the roadmap view and the library view so a step
 * can never be shown as matching in one and not the other.
 */
export function matchesFilters(step, filters) {
  if (filters.noPc && !step.noPcRequired) return false;
  if (filters.free && step.costEstimate > 0) return false;
  if (filters.quick && step.estimatedWeeks > 12) return false;
  if (filters.hideOptional && step.optional) return false;
  if (filters.type && step.type !== filters.type) return false;
  return true;
}

/**
 * Turns a path plus a weekly hour budget into dated weeks. Steps are packed
 * sequentially — this deliberately models "one thing at a time", which is how
 * a person studying around a job actually works.
 */
export function buildSchedule(path, weeklyHours, progressByStep, startDate = new Date()) {
  const budget = Math.max(1, weeklyHours);
  const weeks = [];
  let weekIndex = 0;
  let capacity = budget;

  const remaining = path.steps
    .filter((step) => !step.optional)
    .filter((step) => progressByStep.get(step.id)?.status !== 'done');

  for (const step of remaining) {
    const logged = progressByStep.get(step.id)?.hoursLogged || 0;
    let hoursLeft = Math.max(0, (step.estimatedHours || 0) - logged);
    if (hoursLeft === 0) hoursLeft = 1;

    while (hoursLeft > 0) {
      if (!weeks[weekIndex]) weeks[weekIndex] = { index: weekIndex, items: [], hours: 0 };
      const chunk = Math.min(capacity, hoursLeft);
      const entry = weeks[weekIndex].items.find((i) => i.stepId === step.id);
      if (entry) entry.hours += chunk;
      else weeks[weekIndex].items.push({ stepId: step.id, title: step.title, type: step.type, hours: chunk });

      weeks[weekIndex].hours += chunk;
      hoursLeft -= chunk;
      capacity -= chunk;

      if (capacity <= 0) {
        weekIndex += 1;
        capacity = budget;
      }
    }
  }

  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  return weeks.map((week) => {
    const from = new Date(start.getTime() + week.index * 7 * 86400_000);
    const to = new Date(from.getTime() + 6 * 86400_000);
    return {
      ...week,
      weekNumber: week.index + 1,
      from,
      to,
      items: week.items.map((item) => ({ ...item, hours: Math.round(item.hours * 10) / 10 })),
    };
  });
}
