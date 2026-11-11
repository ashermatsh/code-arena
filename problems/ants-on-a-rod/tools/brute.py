"""Physical simulation of the ants, used to validate the reference solution.

Positions are distinct even integers on a rod [0, 2*length]; every tick each ant
moves one unit. Since all ants share parity, ants walking towards each other
always meet exactly on a tick, so the simulation is exact (no floating point).
"""
import random


def simulate(s, positions, length):
    n = len(s)
    pos = [2 * p for p in positions]
    d = [1 if c == 'R' else -1 for c in s]
    alive = [True] * n
    hits = [0] * n
    end = 2 * length
    while any(alive):
        for i in range(n):
            if alive[i]:
                pos[i] += d[i]
                if pos[i] <= 0 or pos[i] >= end:
                    alive[i] = False
        live = sorted((pos[i], i) for i in range(n) if alive[i])
        for (p1, i1), (p2, i2) in zip(live, live[1:]):
            if p1 == p2:
                d[i1], d[i2] = -d[i1], -d[i2]
                hits[i1] += 1
                hits[i2] += 1
    return hits


def answer(s, positions, length):
    hits = simulate(s, positions, length)
    best = max(hits)
    return [best] + [i for i, h in enumerate(hits) if h == best]


def random_layout(n, rng):
    length = rng.randint(n + 1, 4 * n + 8)
    positions = sorted(rng.sample(range(1, length), n))
    return positions, length
