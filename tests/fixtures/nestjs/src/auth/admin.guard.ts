import { CanActivate, Injectable } from '@nestjs/common';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}
