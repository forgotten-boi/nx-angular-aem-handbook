// Independent verification of the affected-simulator closure maths.
// deps[p] = projects that p imports from (p depends on these)
const deps = {
  'shared-util-format':      [],
  'shared-ui':               ['shared-util-format'],
  'shared-data-access-aem':  ['shared-util-format'],
  'checkout-feature-cart':   ['shared-ui', 'shared-data-access-aem'],
  'account-feature-profile': ['shared-ui', 'shared-data-access-aem'],
  'site':                    ['checkout-feature-cart', 'account-feature-profile', 'shared-ui'],
  'portal':                  ['account-feature-profile', 'shared-ui'],
  'api':                     ['shared-data-access-aem', 'shared-util-format'],
};
const names = Object.keys(deps);

// reverse edges: dependents[x] = projects that directly depend on x
const dependents = Object.fromEntries(names.map(n => [n, []]));
for (const [p, ds] of Object.entries(deps)) for (const d of ds) dependents[d].push(p);

// BFS over reverse edges -> transitive dependents, plus the touched project itself.
function affected(touched) {
  const seen = new Set([touched]);
  const q = [touched];
  while (q.length) {
    const cur = q.shift();
    for (const up of dependents[cur]) if (!seen.has(up)) { seen.add(up); q.push(up); }
  }
  return Array.from(seen).sort();   // Array.from, not slice.call — Set has no length
}

// Brute-force cross-check: does a path exist from candidate down to touched?
function reaches(from, target, seen = new Set()) {
  if (from === target) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return deps[from].some(d => reaches(d, target, seen));
}

let ok = true;
const out = {};
for (const n of names) {
  const bfs = affected(n);
  const brute = names.filter(c => reaches(c, n)).sort();
  const same = JSON.stringify(bfs) === JSON.stringify(brute);
  if (!same) ok = false;
  out[n] = bfs;
  console.log(`${n.padEnd(24)} ${String(bfs.length).padStart(2)}/8  ${same ? 'ok ' : 'MISMATCH'}  ${bfs.join(', ')}`);
}
console.log('\ncross-check:', ok ? 'ALL MATCH' : 'FAILED');
console.log('\nJSON for the widget:\n' + JSON.stringify(out));
