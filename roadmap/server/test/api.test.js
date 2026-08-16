import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { openDb } from '../src/db.js';
import { createApp } from '../src/index.js';
import { ensureSeedUsers } from '../src/seed.js';
import { content } from '../src/content.js';

let baseUrl;
let server;

before(async () => {
  const db = openDb(':memory:');
  ensureSeedUsers(db);
  server = createApp(db).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
});

/** Minimal cookie-aware fetch wrapper — enough for one session at a time. */
function client() {
  let cookie = '';
  return async (path, options = {}) => {
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

async function signedIn(email = 'eric@roadmap.local', password = 'change-me-eric') {
  const call = client();
  const res = await call('/api/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(res.status, 200, `login failed: ${JSON.stringify(res.body)}`);
  return call;
}

describe('content', () => {
  test('serves all 11 paths with steps and resources', async () => {
    const call = client();
    const { status, body } = await call('/api/content');
    assert.equal(status, 200);
    assert.equal(body.paths.length, 11);
    for (const path of body.paths) {
      assert.ok(path.steps.length >= 7, `${path.id} has too few steps`);
      assert.ok(path.nextRoles.length > 0);
      assert.ok(path.interviewPrep.length >= 5);
      for (const step of path.steps) {
        assert.ok(step.resources.length > 0, `${step.id} has no resources`);
        assert.equal(typeof step.noPcRequired, 'boolean');
        assert.equal(typeof step.costEstimate, 'number');
        for (const resource of step.resources) {
          assert.ok(resource.lastVerified, `${step.id} resource missing lastVerified`);
        }
      }
    }
  });

  test('every nextPaths reference points at a real path', () => {
    const ids = new Set(content.paths.map((p) => p.id));
    for (const path of content.paths) {
      for (const next of path.nextPaths) {
        assert.ok(ids.has(next), `${path.id} links to unknown path ${next}`);
      }
    }
  });

  test('computes per-path totals', () => {
    for (const path of content.paths) {
      assert.ok(path.totals.requiredHours > 0);
      assert.ok(path.totals.requiredSteps > 0);
      assert.ok(path.totals.noPcSteps > 0, `${path.id} has no phone-accessible steps`);
    }
  });
});

describe('auth', () => {
  test('rejects a wrong password', async () => {
    const call = client();
    const res = await call('/api/auth/login', {
      method: 'POST',
      body: { email: 'eric@roadmap.local', password: 'wrong' },
    });
    assert.equal(res.status, 401);
  });

  test('signs in, reports the user, and signs out', async () => {
    const call = await signedIn();
    const me = await call('/api/auth/me');
    assert.equal(me.body.user.displayName, 'Eric');

    await call('/api/auth/logout', { method: 'POST' });
    const after = await call('/api/auth/me');
    assert.equal(after.body.user, null);
  });

  test('blocks progress without a session', async () => {
    const call = client();
    const res = await call('/api/progress');
    assert.equal(res.status, 401);
  });

  test('updates settings', async () => {
    const call = await signedIn();
    const res = await call('/api/auth/me', {
      method: 'PATCH',
      body: { weeklyHours: 12, theme: 'dark', shareProgress: true, primaryPath: 'it-support' },
    });
    assert.equal(res.body.user.weeklyHours, 12);
    assert.equal(res.body.user.theme, 'dark');
    assert.equal(res.body.user.shareProgress, true);
  });
});

describe('progress', () => {
  test('records completion, auto-sums cost, and awards badges', async () => {
    const call = await signedIn('matt@roadmap.local', 'change-me-matt');

    const first = await call('/api/progress/it-support-1', { method: 'PUT', body: { status: 'done' } });
    assert.equal(first.status, 200);
    assert.equal(first.body.summary.totalCompleted, 1);
    assert.ok(first.body.newBadges.some((b) => b.id === 'first-step'));

    // A+ Core 1 costs $274 — completing it should show up in the budget view
    // without the user typing a number.
    const cert = await call('/api/progress/it-support-3', { method: 'PUT', body: { status: 'done' } });
    assert.equal(cert.body.summary.totalSpent, 274);
    assert.ok(cert.body.newBadges.some((b) => b.id === 'first-cert'));

    const notes = await call('/api/progress/it-support-2', {
      method: 'PUT',
      body: { status: 'in_progress', notes: 'Watching for a cheap ThinkPad', hoursLogged: 3 },
    });
    assert.equal(notes.body.summary.totalHours, 3);
    assert.equal(notes.body.summary.notesWritten, 1);
  });

  test('rejects unknown steps and statuses', async () => {
    const call = await signedIn();
    const bad = await call('/api/progress/not-a-step', { method: 'PUT', body: { status: 'done' } });
    assert.equal(bad.status, 400);

    const badStatus = await call('/api/progress/it-support-1', { method: 'PUT', body: { status: 'finished' } });
    assert.equal(badStatus.status, 400);
  });

  test('bulk sync applies a queue of offline updates', async () => {
    const call = await signedIn();
    const res = await call('/api/progress/bulk', {
      method: 'POST',
      body: {
        updates: [
          { stepId: 'qa-testing-1', status: 'done' },
          { stepId: 'qa-testing-2', status: 'in_progress', hoursLogged: 2 },
          { stepId: 'nope', status: 'done' },
        ],
      },
    });
    assert.equal(res.body.applied, 2);
    assert.equal(res.body.errors.length, 1);
    assert.ok(res.body.summary.perPath.find((p) => p.pathId === 'qa-testing').percent > 0);
  });

  test('milestones fire when a path crosses a threshold', async () => {
    const call = await signedIn('matt@roadmap.local', 'change-me-matt');
    const path = content.paths.find((p) => p.id === 'it-project-coordination');
    const required = path.steps.filter((s) => !s.optional);

    let milestones = [];
    for (const step of required) {
      const res = await call(`/api/progress/${step.id}`, { method: 'PUT', body: { status: 'done' } });
      milestones = milestones.concat(res.body.milestones);
    }
    assert.ok(milestones.some((m) => m.percent === 100 && m.pathId === 'it-project-coordination'));
  });
});

describe('quiz', () => {
  test('ranks paths and applies constraint penalties', async () => {
    const call = await signedIn();
    const res = await call('/api/quiz', {
      method: 'POST',
      body: {
        answers: { q1: 'a', q2: 'a', q3: 'd', q4: 'a', q5: 'a', q6: 'a', q7: 'a', q8: ['c', 'f'] },
      },
    });
    assert.equal(res.status, 200);
    const { ranked, flags } = res.body.ranking;
    assert.equal(ranked.length, 11);
    assert.ok(flags.includes('noPc'));
    // Phone-only plus free-only should not recommend software engineering first.
    assert.notEqual(ranked[0].pathId, 'software-engineering');
  });
});

describe('sharing and portfolio', () => {
  test('shared dashboard is opt-in on both sides', async () => {
    const eric = await signedIn();
    await eric('/api/auth/me', { method: 'PATCH', body: { shareProgress: false } });
    const hidden = await eric('/api/shared');
    assert.equal(hidden.body.sharing, false);

    await eric('/api/auth/me', { method: 'PATCH', body: { shareProgress: true } });
    const shown = await eric('/api/shared');
    assert.equal(shown.body.sharing, true);
    assert.ok(shown.body.peers.some((p) => p.isYou));
  });

  test('portfolio is private until published', async () => {
    const call = await signedIn('matt@roadmap.local', 'change-me-matt');
    const before = await call('/api/portfolio/matt');
    assert.equal(before.status, 404);

    await call('/api/auth/me', { method: 'PATCH', body: { portfolioPublic: true, headline: 'Aiming at help desk' } });

    const anonymous = client();
    const after = await anonymous('/api/portfolio/matt');
    assert.equal(after.status, 200);
    assert.equal(after.body.headline, 'Aiming at help desk');
    assert.ok(after.body.certifications.length >= 1);
    assert.equal(after.body.email, undefined);
  });

  test('saves and deletes comparisons', async () => {
    const call = await signedIn();
    const created = await call('/api/comparisons', {
      method: 'POST',
      body: { pathIds: ['it-support', 'qa-testing'] },
    });
    assert.equal(created.status, 201);

    const list = await call('/api/comparisons');
    assert.equal(list.body.comparisons.length, 1);

    await call(`/api/comparisons/${created.body.id}`, { method: 'DELETE' });
    const empty = await call('/api/comparisons');
    assert.equal(empty.body.comparisons.length, 0);
  });

  test('rejects a comparison of fewer than two paths', async () => {
    const call = await signedIn();
    const res = await call('/api/comparisons', { method: 'POST', body: { pathIds: ['it-support'] } });
    assert.equal(res.status, 400);
  });
});
