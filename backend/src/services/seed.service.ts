import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { db } from './db.service';
import { prismaService } from './prisma.service';

const prisma = new PrismaClient();

export async function seedDatabase() {
    console.log('🌱 Starting database seed...');

    const hashedPassword = await bcrypt.hash('password123', 10);

    // Create sample users in PostgreSQL (auth uses Prisma)
    const users = [
        { email: 'requester@example.com', name: 'Caragh Kealty', role: 'REQUESTER' as const, businessUnit: 'CDG', salesRepCode: 'SR001', requesterGroupId: 'RG001', salesManager: 'Sales Manager Callinan', districtSalesManager: 'District Manager Sato', nationalSalesManager: 'National Manager Suzuki', localFinanceController: 'Finance Controller Ito', directorCommercialManager: 'Director Nealon', isActive: true },
        { email: 'sales.manager@example.com', name: 'Sales Manager Callinan', role: 'SALES_MANAGER' as const, businessUnit: 'CDG', isActive: true },
        { email: 'district.manager@example.com', name: 'District Manager Sato', role: 'DISTRICT_SALES_MANAGER' as const, businessUnit: 'CDG', isActive: true },
        { email: 'national.manager@example.com', name: 'National Manager Suzuki', role: 'NATIONAL_SALES_MANAGER' as const, businessUnit: 'CDG', isActive: true },
        { email: 'finance.controller@example.com', name: 'Finance Controller Ito', role: 'FINANCE_CONTROLLER' as const, businessUnit: 'CDG', isActive: true },
        { email: 'director@example.com', name: 'Director Nealon', role: 'DIRECTOR_COMMERCIAL' as const, businessUnit: 'CDG', isActive: true },
        { email: 'admin@example.com', name: 'Admin User', role: 'ADMIN' as const, businessUnit: 'CDG', isActive: true },
    ];

    for (const u of users) {
        const existing = await prismaService.findUserByEmail(u.email);
        if (!existing) {
            await prismaService.createUser({
                ...u,
                password: hashedPassword,
            });
        }
    }
    console.log('✅ Created users');

    // Wire hierarchy so tree/list show all users: Requester → Sales Manager → District → National → Finance → Director (root). Admin under Director.
    const requester = await prisma.user.findUnique({ where: { email: 'requester@example.com' } });
    const salesManager = await prisma.user.findUnique({ where: { email: 'sales.manager@example.com' } });
    const districtManager = await prisma.user.findUnique({ where: { email: 'district.manager@example.com' } });
    const nationalManager = await prisma.user.findUnique({ where: { email: 'national.manager@example.com' } });
    const financeController = await prisma.user.findUnique({ where: { email: 'finance.controller@example.com' } });
    const director = await prisma.user.findUnique({ where: { email: 'director@example.com' } });
    const admin = await prisma.user.findUnique({ where: { email: 'admin@example.com' } });

    if (requester?.id && salesManager?.id && districtManager?.id && nationalManager?.id && financeController?.id && director?.id) {
        await prisma.user.update({ where: { id: requester.id }, data: { salesManagerId: salesManager.id } });
        await prisma.user.update({ where: { id: salesManager.id }, data: { districtSalesManagerId: districtManager.id } });
        await prisma.user.update({ where: { id: districtManager.id }, data: { nationalSalesManagerId: nationalManager.id } });
        await prisma.user.update({ where: { id: nationalManager.id }, data: { localFinanceControllerId: financeController.id } });
        await prisma.user.update({ where: { id: financeController.id }, data: { directorCommercialManagerId: director.id } });
        if (admin?.id) {
            await prisma.user.update({ where: { id: admin.id }, data: { directorCommercialManagerId: director.id } });
        }
        console.log('✅ Wired hierarchy (Requester → Sales → District → National → Finance → Director; Admin under Director)');
    }

    // Create sample customers in PostgreSQL (admin list reads from DB, status must be APPROVED to show)
    const sampleCustomers = [
        { businessGroup: 'CDG', firstDigit: '1', code: '100001', sapCode: 'SAP100001', nameJp: '東京科学資材', nameEn: 'Tokyo Scientific Supplies', postalCode: '150-0002', prefecture: 'Tokyo', address: '1-1-1 Shibuya, Tokyo', phone: '000-0000-0001', isActive: true, status: 'APPROVED' as const },
        { businessGroup: 'CDG', firstDigit: '1', code: '100002', sapCode: 'SAP100002', nameJp: '大阪ラボ機器', nameEn: 'Osaka Lab Equipment Co.', postalCode: '530-0001', prefecture: 'Osaka', address: '2-2-2 Umeda, Osaka', phone: '000-0000-0002', isActive: true, status: 'APPROVED' as const },
        { businessGroup: 'CDG', firstDigit: '1', code: '100003', sapCode: 'SAP100003', nameJp: '京都研究資材', nameEn: 'Kyoto Research Materials', postalCode: '604-8006', prefecture: 'Kyoto', address: '3-3-3 Kawaramachi, Kyoto', phone: '000-0000-0003', isActive: true, status: 'APPROVED' as const },
        { businessGroup: 'CDG', firstDigit: '8', code: '800001', sapCode: 'SAP800001', nameJp: '東京大学研究棟', nameEn: 'Tokyo University Research Lab', postalCode: '113-0033', prefecture: 'Tokyo', address: '7-3-1 Hongo, Bunkyo-ku, Tokyo', phone: '000-0000-0004', isActive: true, status: 'APPROVED' as const },
        { businessGroup: 'CDG', firstDigit: '8', code: '800002', sapCode: 'SAP800002', nameJp: '大阪医療センター', nameEn: 'Osaka Medical Center', postalCode: '543-8555', prefecture: 'Osaka', address: '1-8-1 Tennoji, Osaka', phone: '000-0000-0005', isActive: true, status: 'APPROVED' as const },
        { businessGroup: 'CDG', firstDigit: '8', code: '800003', sapCode: 'SAP800003', nameJp: '京都工芸繊維大学', nameEn: 'Kyoto Institute of Technology', postalCode: '606-8585', prefecture: 'Kyoto', address: 'Matsugasaki, Sakyo-ku, Kyoto', phone: '000-0000-0006', isActive: true, status: 'APPROVED' as const },
    ];
    for (const c of sampleCustomers) {
        const existing = await prisma.customer.findFirst({ where: { businessGroup: c.businessGroup, firstDigit: c.firstDigit, code: c.code } });
        if (!existing) {
            await prisma.customer.create({ data: c });
        }
    }
    console.log('✅ Created customers (PostgreSQL)');

    // Create sample product_catalog in PostgreSQL (admin list reads from DB, status must be APPROVED to show)
    const sampleProducts = [
        { businessGroup: 'CDG', code: 'P001', sapCode: 'SAP001', name: 'GelImager MP Imaging System', productNameLocal: 'GelImager MP イメージングシステム', price: 500000, listPrice: 550000, division: 'LSG', isActive: true, status: 'APPROVED' as const },
        { businessGroup: 'CDG', code: 'P002', sapCode: 'SAP002', name: 'TC-100 Thermal Cycler', productNameLocal: 'TC-100 サーマルサイクラー', price: 300000, listPrice: 330000, division: 'LSG', isActive: true, status: 'APPROVED' as const },
        { businessGroup: 'CDG', code: 'P003', sapCode: 'SAP003', name: 'PowerUnit Basic Power Supply', productNameLocal: 'PowerUnit ベーシック電源', price: 50000, listPrice: 55000, division: 'LSG', isActive: true, status: 'APPROVED' as const },
        { businessGroup: 'CDG', code: 'P004', sapCode: 'SAP004', name: 'Protein Assay Kit', productNameLocal: 'プロテインアッセイキット', price: 15000, listPrice: 16500, division: 'LSG', isActive: true, status: 'APPROVED' as const },
        { businessGroup: 'CDG', code: 'P005', sapCode: 'SAP005', name: 'PCR Tubes 200μL', productNameLocal: 'PCRチューブ 200μL', price: 5000, listPrice: 5500, division: 'LSG', isActive: true, status: 'APPROVED' as const },
    ];
    for (const p of sampleProducts) {
        const existing = await prisma.productCatalog.findFirst({ where: { businessGroup: p.businessGroup, code: p.code } });
        if (!existing) {
            await prisma.productCatalog.create({ data: p });
        }
    }
    console.log('✅ Created product catalog (PostgreSQL)');

    // Create sample products (legacy db – catalog may still read from JSON)
    const products = [
        { code: 'P001', name: 'GelImager MP Imaging System', sapCode: 'SAP001', category: 'Equipment', unitPrice: 500000, wholesalePrice: 450000, isConsumable: false, isActive: true },
        { code: 'P002', name: 'TC-100 Thermal Cycler', sapCode: 'SAP002', category: 'Equipment', unitPrice: 300000, wholesalePrice: 270000, isConsumable: false, isActive: true },
        { code: 'P003', name: 'PowerUnit Basic Power Supply', sapCode: 'SAP003', category: 'Equipment', unitPrice: 50000, wholesalePrice: 45000, isConsumable: false, isActive: true },
        { code: 'P004', name: 'Protein Assay Kit', sapCode: 'SAP004', category: 'Consumables', isConsumable: true, unitPrice: 15000, wholesalePrice: 13500, isActive: true },
        { code: 'P005', name: 'PCR Tubes 200μL', sapCode: 'SAP005', category: 'Consumables', isConsumable: true, unitPrice: 5000, wholesalePrice: 4500, isActive: true }
    ];

    products.forEach(product => db.create('products', product));
    console.log('✅ Created products');

    // Create sample channel partners
    const channelPartners = [
        { code: '100001', name: 'Tokyo Scientific Supplies', address: '1-1-1 Shibuya, Tokyo', phone: '000-0000-0007', email: 'contact-497b33@outside.example', isActive: true },
        { code: '100002', name: 'Osaka Lab Equipment Co.', address: '2-2-2 Umeda, Osaka', phone: '000-0000-0008', email: 'contact-d73d0c@outside.example', isActive: true },
        { code: '100003', name: 'Kyoto Research Materials', address: '3-3-3 Kawaramachi, Kyoto', phone: '000-0000-0009', email: 'contact-45f4da@outside.example', isActive: true }
    ];

    channelPartners.forEach(partner => db.create('channelPartners', partner));
    console.log('✅ Created channel partners');

    // Create sample end users
    const endUsers = [
        { code: '800001', name: 'Tokyo University Research Lab', address: '7-3-1 Hongo, Bunkyo-ku, Tokyo', phone: '000-0000-0010', email: 'contact-7b2046@outside.example', isActive: true },
        { code: '800002', name: 'Osaka Medical Center', address: '1-8-1 Tennoji, Osaka', phone: '000-0000-0011', email: 'contact-80e8dc@outside.example', isActive: true },
        { code: '800003', name: 'Kyoto Institute of Technology', address: 'Matsugasaki, Sakyo-ku, Kyoto', phone: '000-0000-0012', email: 'contact-ca3ba1@outside.example', isActive: true }
    ];

    endUsers.forEach(endUser => db.create('endUsers', endUser));
    console.log('✅ Created end users');

    await prisma.$disconnect();
    console.log('🎉 Database seed completed!');
    console.log('\n📝 Sample credentials (PostgreSQL):');
    console.log('   Requester: requester@example.com / password123');
    console.log('   Sales Manager: sales.manager@example.com / password123');
    console.log('   District Manager: district.manager@example.com / password123');
    console.log('   National Manager: national.manager@example.com / password123');
    console.log('   Finance Controller: finance.controller@example.com / password123');
    console.log('   Director: director@example.com / password123');
    console.log('   Admin: admin@example.com / password123');
}
