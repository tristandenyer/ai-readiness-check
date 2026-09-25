/* The subset of Vitest's test API these tests use, built on node:test and
   node:assert so the package needs no test framework. Tests import from
   here instead of "vitest"; otherwise they read the same. */
import {
  describe as nodeDescribe,
  it as nodeIt,
  before,
  after,
  beforeEach,
  afterEach,
  mock,
} from "node:test";
import assert from "node:assert/strict";
import { format } from "node:util";

export { beforeEach, afterEach };
export const beforeAll = before;
export const afterAll = after;

/* it.each(cases)(name, fn): each case is spread into fn if it is an
   array; %s and friends in the name are filled from the case. */
function withEach(base) {
  const wrapped = (name, fn, timeout) =>
    base(name, typeof timeout === "number" ? { timeout } : {}, fn);
  wrapped.each = (cases) => (name, fn, timeout) => {
    for (const c of cases) {
      const args = Array.isArray(c) ? c : [c];
      wrapped(format(name, ...args), () => fn(...args), timeout);
    }
  };
  return wrapped;
}

export const it = withEach(nodeIt);
export const describe = (name, fn) => nodeDescribe(name, fn);

function isMockFn(fn) {
  return typeof fn === "function" && fn.mock && Array.isArray(fn.mock.calls);
}

function matchers(actual, message, negate) {
  const check = (pass, text) => {
    if (pass === negate) {
      assert.fail(message ? `${message}: ${text}` : text);
    }
  };
  const show = (v) => format("%o", v).slice(0, 400);
  const not = negate ? "not " : "";
  return {
    toBe: (expected) => check(Object.is(actual, expected), `expected ${show(actual)} ${not}to be ${show(expected)}`),
    toEqual: (expected) => {
      let equal = true;
      if (expected instanceof ArrayContaining) {
        equal = Array.isArray(actual) && expected.items.every((item) =>
          actual.some((a) => {
            try {
              assert.deepEqual(a, item);
              return true;
            } catch {
              return false;
            }
          }));
      } else {
        try {
          assert.deepEqual(actual, expected);
        } catch {
          equal = false;
        }
      }
      check(equal, `expected ${show(actual)} ${not}to equal ${show(expected)}`);
    },
    toBeNull: () => check(actual === null, `expected ${show(actual)} ${not}to be null`),
    toBeUndefined: () => check(actual === undefined, `expected ${show(actual)} ${not}to be undefined`),
    toBeTruthy: () => check(Boolean(actual), `expected ${show(actual)} ${not}to be truthy`),
    toContain: (item) => check(actual?.includes?.(item) ?? false, `expected ${show(actual)} ${not}to contain ${show(item)}`),
    toMatch: (pattern) => {
      const re = typeof pattern === "string" ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) : pattern;
      check(re.test(String(actual)), `expected ${show(actual)} ${not}to match ${re}`);
    },
    toHaveLength: (n) => check(actual?.length === n, `expected length ${actual?.length} ${not}to be ${n}`),
    toBeGreaterThan: (n) => check(actual > n, `expected ${actual} ${not}to be > ${n}`),
    toBeGreaterThanOrEqual: (n) => check(actual >= n, `expected ${actual} ${not}to be >= ${n}`),
    toBeLessThan: (n) => check(actual < n, `expected ${actual} ${not}to be < ${n}`),
    toBeLessThanOrEqual: (n) => check(actual <= n, `expected ${actual} ${not}to be <= ${n}`),
    toThrow: (pattern) => {
      let threw = false;
      let error;
      try {
        actual();
      } catch (err) {
        threw = true;
        error = err;
      }
      const matched = threw && (!pattern || (pattern instanceof RegExp ? pattern.test(error.message) : error.message.includes(pattern)));
      check(matched, `expected function ${not}to throw${pattern ? ` ${pattern}` : ""}`);
    },
    toHaveBeenCalled: () => {
      if (!isMockFn(actual)) assert.fail("toHaveBeenCalled needs a vi.fn() mock");
      check(actual.mock.calls.length > 0, `expected mock ${not}to have been called`);
    },
  };
}

export function expect(actual, message) {
  const m = matchers(actual, message, false);
  m.not = matchers(actual, message, true);
  return m;
}
class ArrayContaining {
  constructor(items) {
    this.items = items;
  }
}
expect.arrayContaining = (items) => new ArrayContaining(items);

/* vi.fn / vi.spyOn on top of node:test's mock. A mock made by vi.fn()
   exposes .mock.calls as arrays of arguments, like Vitest. */
export const vi = {
  fn(impl = () => {}) {
    const m = mock.fn(impl);
    const wrapper = (...args) => m(...args);
    Object.defineProperty(wrapper, "mock", {
      get: () => ({ calls: m.mock.calls.map((c) => c.arguments) }),
    });
    return wrapper;
  },
  spyOn(object, method) {
    const m = mock.method(object, method);
    return {
      mockImplementation(impl) {
        m.mock.mockImplementation(impl);
        return this;
      },
    };
  },
  restoreAllMocks() {
    mock.restoreAll();
  },
};
