### Key idea: let the ants walk through each other

When two identical ants bounce off each other, the picture looks exactly the same as if they had **passed through** one another and kept walking. Call these pass-through walkers *ghosts*. Two facts follow:

1. **Ants never change order.** Two real ants can't swap places, so at any moment the `k`-th ant from the left (among all ants, counting the ones that already fell off the left end) is always the original ant `k`.
2. **Ghost meetings are easy to count.** A ghost only moves in a straight line, so a right-walking ghost that starts at index `i` meets a left-walking ghost from index `j` exactly once, and only when `i < j`. Every such meeting is one real collision.

### Which two ants collide?

Take the meeting of right-walker `i` and left-walker `j` at time `t = (x_j - x_i) / 2`, at point `p = (x_i + x_j) / 2`. Which ghosts are strictly to the left of `p` at that moment?

- a right-walker from `k` is at `x_k + t < p` exactly when `x_k < x_i`, i.e. `k < i`;
- a left-walker from `k` is at `x_k - t < p` exactly when `x_k < x_j`, i.e. `k < j`.

So if `a` = number of `R`s before `i` and `b` = number of `L`s before `j`, there are `m = a + b` ants to the left, and the collision is between ants `m` and `m + 1`. **The actual positions cancel out**, which is why the answer only depends on the string.

### Counting in O(N)

Let `pairs[m]` be the number of collisions between ants `m` and `m + 1`. Fix a left-walker at index `j` with `b` left-walkers before it. It meets every right-walker before it, and those have `a = 0, 1, ..., (j - b) - 1`, so it adds one to `pairs[m]` for every `m` in `[b, j - 1]`. That is a range increment, so a difference array handles all of them in linear time.

Finally, ant `k` takes part in the collisions of the pairs on both of its sides:

```
collisions[k] = pairs[k - 1] + pairs[k]
```

Take the maximum and list every index that reaches it.

### Complexity

`O(N)` time and `O(N)` memory.

### Python

```python
class Solution:
    def antsOnARod(self, s: str) -> List[int]:
        n = len(s)
        diff = [0] * (n + 1)
        lefts = 0
        for j, c in enumerate(s):
            if c == 'L':
                diff[lefts] += 1
                diff[j] -= 1
                lefts += 1
        pairs, run = [0] * n, 0
        for m in range(n):
            run += diff[m]
            pairs[m] = run
        counts = [pairs[k] + (pairs[k - 1] if k else 0) for k in range(n)]
        best = max(counts)
        return [best] + [k for k in range(n) if counts[k] == best]
```
