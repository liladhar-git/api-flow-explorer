'use client';
const base = process.env.NEXT_PUBLIC_API_URL;

export function loadRemote() {
  return fetch(`${base}/api/products`);
}
