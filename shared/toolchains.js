// In-browser toolchains for C++ and Java. The browser runners and the static
// build both read these values, so the precompiled C++ header shipped with the
// site always matches the compiler the browser downloads.

// C++: Clang/LLD compiled to WebAssembly (YoWASP), producing WASI programs.
export const CLANG_VERSION = '22.0.0-git20542-10';
export const CLANG_URL = `https://cdn.jsdelivr.net/npm/@yowasp/clang@${CLANG_VERSION}/gen/bundle.js`;
export const WASI_SHIM_URL = 'https://cdn.jsdelivr.net/npm/@bjorn3/browser_wasi_shim@0.4.2/dist/index.js';

// wasm32-wasi has no C++ exception runtime, hence -fno-exceptions.
export const CPP_COMPILE_FLAGS = ['-std=c++17', '-O2', '-fno-exceptions', '-I.'];
export const CPP_LINK_FLAGS = ['-Wl,-z,stack-size=67108864'];

// libc++ has no <bits/stdc++.h> (a GCC extension), so we provide one.
export const STDCPP_HEADER = `#pragma once
// Stand-in for GCC's <bits/stdc++.h>.
#include <algorithm>
#include <array>
#include <bitset>
#include <cassert>
#include <cctype>
#include <cfloat>
#include <chrono>
#include <climits>
#include <cmath>
#include <complex>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <fstream>
#include <functional>
#include <iomanip>
#include <iostream>
#include <iterator>
#include <limits>
#include <list>
#include <map>
#include <memory>
#include <numeric>
#include <optional>
#include <queue>
#include <random>
#include <set>
#include <sstream>
#include <stack>
#include <string>
#include <string_view>
#include <tuple>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <variant>
#include <vector>
`;

// Java: CheerpJ, a Java runtime in WebAssembly that also runs javac. Its free
// tier must be loaded from the CheerpJ CDN (self-hosting needs a licence).
export const CHEERPJ_LOADER = 'https://cjrtnc.leaningtech.com/5.0/loader.js';
export const CHEERPJ_JAVA_VERSION = 17;

// Where the user's code goes in the C++ driver template shipped to the browser.
export const USER_CODE_PLACEHOLDER = '/*@@CODE_ARENA_USER_CODE@@*/';
