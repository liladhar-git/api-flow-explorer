import { UserList } from '../components/UserList';
import { getJson } from '../api/http';

const API_URL = process.env.REACT_APP_API_URL;

export async function loadOrders() {
  const res = await fetch('/api/orders');
  return res.json();
}

export async function removeOrder(orderId: string) {
  return fetch(`/api/orders/${orderId}`, { method: 'DELETE' });
}

export async function updateAvatar(id: string, url: string) {
  return fetch(`/api/users/${id}/avatar`, { method: 'PUT', body: JSON.stringify({ url }) });
}

export async function checkHealth() {
  return fetch(`${API_URL}/health`);
}

export async function loadViaWrapper() {
  return getJson('/api/users');
}

export async function missing() {
  return fetch('/api/does-not-exist');
}

export async function charge() {
  return fetch('https://api.stripe.com/v1/charges', { method: 'POST' });
}

export async function dynamicTarget(build: () => string) {
  const target = build();
  return fetch(target);
}

export default function UsersPage() {
  return <UserList />;
}
