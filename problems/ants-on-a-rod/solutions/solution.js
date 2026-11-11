/**
 * @param {string} s
 * @return {number[]}
 */
var antsOnARod = function(s) {
    const n = s.length;
    const diff = new Int32Array(n + 1);
    let lefts = 0;
    for (let j = 0; j < n; j++) {
        if (s[j] === 'L') {
            diff[lefts]++;   // this left-walker adds a collision to pairs[lefts .. j-1]
            diff[j]--;
            lefts++;
        }
    }
    const counts = new Int32Array(n);
    let run = 0, prev = 0, best = 0;
    for (let k = 0; k < n; k++) {
        run += diff[k];                // run = pairs[k]: collisions between ants k and k+1
        counts[k] = prev + run;
        prev = run;
        best = Math.max(best, counts[k]);
    }
    const res = [best];
    for (let k = 0; k < n; k++) if (counts[k] === best) res.push(k);
    return res;
};
