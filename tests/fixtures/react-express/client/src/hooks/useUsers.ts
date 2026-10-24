import { useEffect, useState } from 'react';
import { fetchUsers } from '@client/api/users';

export function useUsers() {
  const [users, setUsers] = useState<unknown[]>([]);
  useEffect(() => {
    fetchUsers().then((r) => setUsers(r.data));
  }, []);
  return users;
}
