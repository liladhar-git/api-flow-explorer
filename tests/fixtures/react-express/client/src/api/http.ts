export function getJson(url: string) {
  return fetch(url).then((r) => r.json());
}
