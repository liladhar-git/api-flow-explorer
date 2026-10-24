import { ProductList } from '@/components/ProductList';

export default async function Home() {
  const res = await fetch('http://localhost:3000/api/products');
  const products = await res.json();
  return <ProductList initial={products} />;
}
