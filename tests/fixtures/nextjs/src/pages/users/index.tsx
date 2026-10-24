export async function getServerSideProps() {
  const res = await fetch('http://localhost:3000/api/users');
  return { props: { users: await res.json() } };
}

export default function Users({ users }: { users: unknown[] }) {
  return <ul>{users.length}</ul>;
}
