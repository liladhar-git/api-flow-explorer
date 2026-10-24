import { prisma } from '@/lib/prisma';

export async function listProducts() {
  return prisma.product.findMany();
}

export async function removeProduct(id: string) {
  return prisma.product.delete({ where: { id } });
}
