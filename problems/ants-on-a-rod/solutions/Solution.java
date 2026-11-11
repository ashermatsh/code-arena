class Solution {
    public int[] antsOnARod(String s) {
        int n = s.length();
        int[] diff = new int[n + 1];
        int lefts = 0;
        for (int j = 0; j < n; j++) {
            if (s.charAt(j) == 'L') {
                diff[lefts]++;   // this left-walker adds a collision to pairs[lefts .. j-1]
                diff[j]--;
                lefts++;
            }
        }
        int[] counts = new int[n];
        int run = 0, prev = 0, best = 0, ties = 0;
        for (int k = 0; k < n; k++) {
            run += diff[k];      // run = pairs[k]: collisions between ants k and k+1
            counts[k] = prev + run;
            prev = run;
            best = Math.max(best, counts[k]);
        }
        for (int k = 0; k < n; k++) if (counts[k] == best) ties++;
        int[] res = new int[ties + 1];
        res[0] = best;
        for (int k = 0, w = 1; k < n; k++) if (counts[k] == best) res[w++] = k;
        return res;
    }
}
