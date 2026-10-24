// self-recursive wrapper: passes its own parameter back to itself
export function get(url: string, retries = 2): Promise<unknown> {
  return fetch(url).catch(() => (retries > 0 ? get(url, retries - 1) : Promise.reject()));
}
// mutual recursion between two wrappers
export function ping(path: string): unknown {
  return pong(path);
}
export function pong(path: string): unknown {
  return fetch(path) && ping(path);
}
