import { useUsers } from '../hooks/useUsers';
import { UserCard } from './UserCard';

export function UserList() {
  const users = useUsers() as { id: string }[];
  return (
    <ul>
      {users.map((u) => (
        <UserCard key={u.id} id={u.id} />
      ))}
    </ul>
  );
}
