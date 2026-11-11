class Solution {
public:
    vector<int> antsOnARod(string s) {
        int n = s.size();
        vector<int> diff(n + 1, 0);
        int lefts = 0;
        for (int j = 0; j < n; j++) {
            if (s[j] == 'L') {
                diff[lefts]++;   // this left-walker adds a collision to pairs[lefts .. j-1]
                diff[j]--;
                lefts++;
            }
        }
        vector<int> counts(n);
        int run = 0, prev = 0, best = 0;
        for (int k = 0; k < n; k++) {
            run += diff[k];      // run = pairs[k]: collisions between ants k and k+1
            counts[k] = prev + run;
            prev = run;
            best = max(best, counts[k]);
        }
        vector<int> res = {best};
        for (int k = 0; k < n; k++)
            if (counts[k] == best) res.push_back(k);
        return res;
    }
};
