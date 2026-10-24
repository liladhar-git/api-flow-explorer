import { listProducts } from '@/lib/products';

export async function GET() {
  return Response.json(await listProducts());
}

export async function POST(req: Request) {
  return Response.json(await req.json(), { status: 201 });
}
