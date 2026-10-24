import { fmt } from './util';
import { listA, saveA } from './services/a';
import { countB } from './services/b';

export function report() {
  return fmt(1) + listA() + saveA({}) + countB();
}
