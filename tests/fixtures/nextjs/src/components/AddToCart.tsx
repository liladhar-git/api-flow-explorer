'use client';
import axios from 'axios';

export function AddToCart() {
  const add = () => axios.post('/api/products', { sku: 1 });
  const remove = (id: string) => axios.delete(`/api/products/${id}`);
  return <button onClick={add} onDoubleClick={() => remove('1')}>add</button>;
}
