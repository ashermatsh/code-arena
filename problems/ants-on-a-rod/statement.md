There are `N` ants walking on a horizontal rod. Each ant is walking either towards the **left** or towards the **right**.

- If an ant reaches either end of the rod, it falls off and is removed.
- If two ants run into each other, both immediately reverse direction and start walking away from each other. This event counts as **one collision for each** of the two ants involved.

You are given the initial directions of the ants, listed in order from left to right. Consider the number of collisions each ant experiences before it falls off the rod. Report the **largest** such number, together with **every ant** that achieves it.

### Input

A string `s` of length `N`. The `i`-th character is `'L'` or `'R'`, giving the initial direction of the `i`-th ant from the left (`0 <= i < N`).

### Output

Return a single array. Its first element is the maximum number of collisions experienced by any single ant. Every element after that is the index of an ant that experiences that many collisions, listed in increasing order.

Indices refer to an ant's original index, i.e. its rank from the left at time zero.

{{examples}}

### Constraints

- `1 <= N <= 100000`
- Every character of `s` is either `'L'` or `'R'`

### Notes

- Ants have no size: each ant occupies a single point on the rod. Every ant moves at the same constant speed.
- All ants start at distinct positions, so no two ants are touching at the start.
- The exact starting positions of the ants and the length of the rod are not given. Only their left-to-right ordering and initial directions are known.
- A collision occurs exactly when two ants arrive at the same point. Collisions are instantaneous: reversal happens immediately, with no loss of speed.
- Two ants are never at the same point except at the instant of a collision, and no more than two ants are ever involved in a single collision.
