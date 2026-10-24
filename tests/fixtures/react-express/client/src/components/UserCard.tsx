import { fetchUser } from '../api/users';

export function UserCard({ id }: { id: string }) {
  return <button onClick={() => fetchUser(id)}>load {id}</button>;
}
