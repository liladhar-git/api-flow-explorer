export interface CreateItemInput {
  title: string;
  price: number;
  inStock?: boolean;
}
export function createItem(input: CreateItemInput) {
  return input;
}
