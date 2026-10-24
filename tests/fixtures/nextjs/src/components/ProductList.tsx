'use client';
import { useEffect, useState } from 'react';

export function ProductList({ initial }: { initial: unknown[] }) {
  const [items, setItems] = useState(initial);
  useEffect(() => {
    fetch('/api/products').then((r) => r.json()).then(setItems);
  }, []);
  return <ul>{items.length}</ul>;
}
