import { openDb } from '../db.js';
import { ensureSeedUsers } from '../seed.js';
import { content } from '../content.js';

const db = openDb();
const created = ensureSeedUsers(db);

console.log(`Content loaded: ${content.paths.length} paths, ${content.paths.reduce((n, p) => n + p.steps.length, 0)} steps, ${content.badges.length} badges (version ${content.version})`);

if (created.length === 0) {
  console.log('Accounts already exist — nothing to seed.');
} else {
  for (const user of created) {
    console.log(`Created account: ${user.displayName} <${user.email}>`);
  }
  console.log('\nSet ERIC_PASSWORD / MATT_PASSWORD before deploying, or change the passwords after first login.');
}
