import { removeProduct } from '@/lib/products';

export async function GET() {
  return Response.json({});
}

export async function DELETE(_req: Request, ctx: { params: { id: string } }) {
  await removeProduct(ctx.params.id);
  return new Response(null, { status: 204 });
}

const handler = async () => Response.json({ updated: true });
export { handler as PUT };
