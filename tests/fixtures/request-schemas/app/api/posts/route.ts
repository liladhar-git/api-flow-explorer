export async function POST(request: Request) {
  const { title, tags = [] } = await request.json();
  const url = new URL(request.url);
  const draft = url.searchParams.get('draft');
  return Response.json({ title, tags, draft });
}
