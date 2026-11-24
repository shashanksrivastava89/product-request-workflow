import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const products = [
    { cdgCode: '33001', sapCode: '6651150', name: 'MPX ANA Screen 100 Tests', price: 96000 },
    { cdgCode: '33322', sapCode: '6631101', name: 'MPX CALIBRATOR SET', price: 56000 },
    { cdgCode: '33324', sapCode: '6631131', name: 'MPX Control Set, ANA Screen', price: 56000 },
    { cdgCode: '33413', sapCode: '6651250', name: 'MultiPlex EBV IgG 100 tests', price: 96000 },
    { cdgCode: '33414', sapCode: '6631201', name: 'MultiPlex EBV IgG Calibrator Set', price: 56000 },
    { cdgCode: '33416', sapCode: '6631231', name: 'MultiPlex EBV IgG Control Set', price: 56000 },
    { cdgCode: '33420', sapCode: '6651350', name: 'MultiPlex EBV IgM 100 tests', price: 96000 },
    { cdgCode: '33421', sapCode: '6631300', name: 'MultiPlex EBV IgM Calibrator Set', price: 56000 },
    { cdgCode: '33423', sapCode: '6631330', name: 'MultiPlex EBV IgM Control Set', price: 56000 },
    { cdgCode: '33345', sapCode: '6653350', name: 'MPX HSV 1/2 IgG, 100 tests', price: 96000 },
    { cdgCode: '33341', sapCode: '6633300', name: 'MPX Calibrator Set,HSV 1&2 IgG', price: 24000 },
    { cdgCode: '33343', sapCode: '6633330', name: 'MPX 2200 Ctrl Set,HSV 1&2 IgG', price: 24000 },
    { cdgCode: '33021', sapCode: '6652450', name: 'MPX MMRV IgG, 100 tests', price: 96000 },
    { cdgCode: '33022', sapCode: '6632400', name: 'MultiPlex 2200 MMRV Calibrator', price: 56000 },
    { cdgCode: '33024', sapCode: '6632430', name: 'MULTIPLEX 2200 CTRL', price: 56000 },
    { cdgCode: '33456', sapCode: '12000930', name: 'MultiPlex MMV IgM Reagent Pack', price: 144000 },
    { cdgCode: '33457', sapCode: '12000933', name: 'MultiPlex MMV IgM Calibrator Set', price: 56000 },
    { cdgCode: '33459', sapCode: '12000931', name: 'MultiPlex MMV IgM Control Set', price: 56000 },
    { cdgCode: '33364', sapCode: '6651650', name: 'MPX ToRC IgG 100 Tests', price: 96000 },
];

async function seedProducts() {
    console.log('🌱 Seeding products...');

    try {
        // Delete existing products
        await prisma.product.deleteMany({});
        console.log('✓ Cleared existing products');

        // Insert new products
        const result = await prisma.product.createMany({
            data: products,
            skipDuplicates: true,
        });

        console.log(`✓ Created ${result.count} products`);
        console.log('✅ Product seeding completed successfully!');
    } catch (error) {
        console.error('❌ Error seeding products:', error);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

// Run if called directly
if (require.main === module) {
    seedProducts()
        .catch((error) => {
            console.error(error);
            process.exit(1);
        });
}

export { seedProducts };
