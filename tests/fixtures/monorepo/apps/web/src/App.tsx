import { getJson } from '@acme/shared/http';
import { USERS_PATH } from '@acme/shared/endpoints';
import { Header } from '@/Header';

export function App() {
  getJson(USERS_PATH);
  return <Header />;
}
