// Reference solution and input validator. Shared by the judge server (to
// compute expected answers for custom test cases) and by the browser-only
// mode, so it must stay plain ES2020 with no imports.

export function solve(s) {
  const n = s.length;
  const diff = new Int32Array(n + 1);
  let lefts = 0;
  for (let j = 0; j < n; j++) {
    if (s[j] === 'L') {
      diff[lefts] += 1;
      diff[j] -= 1;
      lefts++;
    }
  }
  const pairs = new Int32Array(n);
  let run = 0;
  for (let m = 0; m < n; m++) {
    run += diff[m];
    pairs[m] = run;
  }
  let best = -1;
  const counts = new Int32Array(n);
  for (let k = 0; k < n; k++) {
    counts[k] = pairs[k] + (k > 0 ? pairs[k - 1] : 0);
    if (counts[k] > best) best = counts[k];
  }
  const out = [best];
  for (let k = 0; k < n; k++) if (counts[k] === best) out.push(k);
  return out;
}

// Returns an error message for inputs outside the problem's constraints, or null.
export function validate(s) {
  if (typeof s !== 'string') return 's must be a string';
  if (s.length < 1 || s.length > 100000) return `length of s must be between 1 and 100000 (got ${s.length})`;
  if (!/^[LR]+$/.test(s)) return "s may only contain the characters 'L' and 'R'";
  return null;
}
