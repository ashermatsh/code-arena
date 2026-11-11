"""Cross-check the reference solution against the physical simulation.

For every small direction string we try several random rod layouts: the
simulated answer must not depend on the layout and must equal the reference.
"""
import itertools
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "solutions"))

from brute import answer, random_layout  # noqa: E402
from solution import Solution  # noqa: E402


def main():
    rng = random.Random(2026)
    sol = Solution()
    checked = 0
    cases = []
    for n in range(1, 11):
        cases += ["".join(p) for p in itertools.product("LR", repeat=n)]
    for _ in range(300):
        n = rng.randint(11, 40)
        cases.append("".join(rng.choice("LR") for _ in range(n)))
    for s in cases:
        want = sol.antsOnARod(s)
        for _ in range(3):
            positions, length = random_layout(len(s), rng)
            got = answer(s, positions, length)
            if got != want:
                print(f"MISMATCH s={s} positions={positions} length={length}")
                print(f"  simulation: {got}\n  reference:  {want}")
                sys.exit(1)
            checked += 1
    print(f"OK: reference matches the physical simulation on {checked} layouts "
          f"({len(cases)} direction strings)")


if __name__ == "__main__":
    main()
