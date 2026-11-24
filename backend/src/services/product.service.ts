import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface Product {
    cdgCode: string;
    sapCode: string;
    name: string;
    price: number;
    isActive: boolean;
}

export const getAllProducts = async (): Promise<Product[]> => {
    const dbProducts = await prisma.productCatalog.findMany({
        where: {
            // Only get active products (we can add isActive field later if needed)
        },
    });

    return dbProducts.map(p => ({
        cdgCode: p.code,
        sapCode: p.sapCode,
        name: p.name,
        price: Number(p.price),
        isActive: true, // All products in catalog are active
    }));
};

export const getProductByCode = async (cdgCode: string): Promise<Product | undefined> => {
    const product = await prisma.productCatalog.findFirst({
        where: {
            code: cdgCode,
        },
    });

    if (!product) return undefined;

    return {
        cdgCode: product.code,
        sapCode: product.sapCode,
        name: product.name,
        price: Number(product.price),
        isActive: true,
    };
};

export const searchProducts = async (query: string): Promise<Product[]> => {
    const lowerQuery = query.toLowerCase();
    const allProducts = await getAllProducts();

    return allProducts.filter(p =>
        p.name.toLowerCase().includes(lowerQuery) ||
        p.cdgCode.includes(query) ||
        p.sapCode.includes(query)
    );
};
