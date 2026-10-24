export const asyncHandler = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) =>
  Promise.resolve(fn(req, res)).catch(next);
