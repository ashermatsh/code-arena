from typing import List


class Solution:
    def antsOnARod(self, s: str) -> List[int]:
        # Treat colliding ants as passing through each other ("ghosts").
        # Ants never overtake, so the ant at rank k is always original ant k.
        #
        # The a-th right-walker (index i) and the b-th left-walker (index j > i)
        # meet exactly once. At that moment the ghosts strictly to the left of
        # the meeting point are the a right-walkers before i and the b
        # left-walkers before j, so the collision is between ants m and m+1
        # with m = a + b -- independent of the actual positions.
        #
        # For a fixed left-walker j with b = #L before it, a ranges over
        # 0 .. (#R before j) - 1, so m covers [b, j - 1]: a range add.
        n = len(s)
        diff = [0] * (n + 1)
        lefts = 0
        for j, c in enumerate(s):
            if c == 'L':
                if lefts < j:
                    diff[lefts] += 1
                    diff[j] -= 1
                lefts += 1
        pairs = [0] * n  # pairs[m] = collisions between ants m and m+1
        run = 0
        for m in range(n):
            run += diff[m]
            pairs[m] = run
        counts = [pairs[k] + (pairs[k - 1] if k else 0) for k in range(n)]
        best = max(counts)
        return [best] + [k for k in range(n) if counts[k] == best]
