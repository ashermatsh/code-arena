"""Regenerate tests/samples.json and tests/hidden.json.

Expected outputs come from the reference solution, which tools/verify.py checks
against a physical simulation. Run from anywhere:

    python3 problems/ants-on-a-rod/tools/generate_tests.py
"""
import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "solutions"))

from solution import Solution  # noqa: E402

SAMPLES = [
    ("RL", "The two ants walk into each other, collide once, reverse, and then walk off "
           "opposite ends. The maximum is 1, and both ants achieve it, so both indices follow."),
    ("RRL", "Ant 1 meets ant 2 first; both reverse. Ant 1 (now moving left) then meets ant 0 "
            "(still moving right); both reverse again. Ant 1 is involved in both collisions, "
            "while ants 0 and 2 have one each. The maximum is 2, achieved only by ant 1."),
    ("LLRR", "Every ant walks away from the others, so nobody ever collides. The maximum is 0 "
             "and all four ants achieve it."),
]


def hidden_inputs():
    rng = random.Random(20260824)
    rand = lambda n, p=0.5: "".join("R" if rng.random() < p else "L" for _ in range(n))
    big = 100_000
    cases = ["L", "R", "LR", "LL", "RR", "RLRL", "LRLR", "RRRLLL", "RLLL", "RRRL",
             "LRRL", "RLLR", "RRLRLL", "LRLRLRLR"]
    cases += [rand(rng.randint(3, 20)) for _ in range(12)]
    cases += [rand(rng.randint(100, 2000), rng.choice([0.3, 0.5, 0.7])) for _ in range(6)]
    cases += [
        rand(big),
        rand(big, 0.9),
        rand(big, 0.1),
        rand(big - 1),
        "R" * (big // 2) + "L" * (big // 2),
        "RL" * (big // 2),
        "LR" * (big // 2),
        "R" * (big - 1) + "L",
        "R" + "L" * (big - 1),
        "L" * big,
        "R" * 40_000 + "L" * 20_000 + "R" * 20_000 + "L" * 20_000,
    ]
    return cases


def dump(path, tests):
    with open(path, "w") as f:
        f.write("[\n")
        f.write(",\n".join(json.dumps(t, separators=(",", ":")) for t in tests))
        f.write("\n]\n")


def main():
    sol = Solution()
    samples = [{"args": [s], "expected": sol.antsOnARod(s), "explanation": e} for s, e in SAMPLES]
    hidden = [{"args": [s], "expected": sol.antsOnARod(s)} for s in hidden_inputs()]
    dump(os.path.join(ROOT, "tests", "samples.json"), samples)
    dump(os.path.join(ROOT, "tests", "hidden.json"), hidden)
    print(f"wrote {len(samples)} sample and {len(hidden)} hidden tests")


if __name__ == "__main__":
    main()
