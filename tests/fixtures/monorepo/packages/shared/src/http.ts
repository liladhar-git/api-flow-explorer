export function getJson(path: string) {
  return fetch(path).then((r) => r.json());
}
