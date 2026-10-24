export function requestLogger(req: any, res: any, next: () => void) {
  console.log(req.method, req.url);
  next();
}
