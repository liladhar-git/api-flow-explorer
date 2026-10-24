import { CanActivate, Injectable, NestInterceptor } from '@nestjs/common';

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate() { return true; }
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  canActivate() { return true; }
}

@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(context: unknown, next: { handle(): unknown }) { return next.handle(); }
}
