import { useEffect } from 'react';

export default function UserPage({ id }: { id: string }) {
  useEffect(() => {
    fetch(`/api/users/${id}`);
  }, [id]);
  return <div>{id}</div>;
}
