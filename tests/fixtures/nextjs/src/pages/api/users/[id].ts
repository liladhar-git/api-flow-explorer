export default async function handler(req: any, res: any) {
  switch (req.method) {
    case 'GET':
      return res.json({});
    case 'DELETE':
      return res.status(204).end();
  }
}
