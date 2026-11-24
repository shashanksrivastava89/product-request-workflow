import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Starting database seed...');

    // Create sample users
    const hashedPassword = await bcrypt.hash('password123', 10);

    // Requester
    const requester = await prisma.user.upsert({
        where: { email: 'requester@example.com' },
        update: {},
        create: {
            email: 'requester@example.com',
            password: hashedPassword,
            name: 'Caragh Kealty',
            role: 'REQUESTER',
            businessUnit: 'CDG',
            salesRepCode: 'SR001',
            requesterGroupId: 'RG001',
            salesManager: 'Sales Manager Callinan',
            districtSalesManager: 'District Manager Sato',
            nationalSalesManager: 'National Manager Suzuki',
            localFinanceController: 'Finance Controller Ito',
            directorCommercialManager: 'Director Nealon'
        }
    });

    // Sales Manager
    const salesManager = await prisma.user.upsert({
        where: { email: 'sales.manager@example.com' },
        update: {},
        create: {
            email: 'sales.manager@example.com',
            password: hashedPassword,
            name: 'Sales Manager Callinan',
            role: 'SALES_MANAGER',
            businessUnit: 'CDG'
        }
    });

    // District Sales Manager
    const districtManager = await prisma.user.upsert({
        where: { email: 'district.manager@example.com' },
        update: {},
        create: {
            email: 'district.manager@example.com',
            password: hashedPassword,
            name: 'District Manager Sato',
            role: 'DISTRICT_SALES_MANAGER',
            businessUnit: 'CDG'
        }
    });

    // National Sales Manager
    const nationalManager = await prisma.user.upsert({
        where: { email: 'national.manager@example.com' },
        update: {},
        create: {
            email: 'national.manager@example.com',
            password: hashedPassword,
            name: 'National Manager Suzuki',
            role: 'NATIONAL_SALES_MANAGER',
            businessUnit: 'CDG'
        }
    });

    // Finance Controller
    const financeController = await prisma.user.upsert({
        where: { email: 'finance.controller@example.com' },
        update: {},
        create: {
            email: 'finance.controller@example.com',
            password: hashedPassword,
            name: 'Finance Controller Ito',
            role: 'FINANCE_CONTROLLER',
            businessUnit: 'CDG'
        }
    });

    // Director
    const director = await prisma.user.upsert({
        where: { email: 'director@example.com' },
        update: {},
        create: {
            email: 'director@example.com',
            password: hashedPassword,
            name: 'Director Nealon',
            role: 'DIRECTOR_COMMERCIAL',
            businessUnit: 'CDG'
        }
    });

    // Admin
    const admin = await prisma.user.upsert({
        where: { email: 'admin@example.com' },
        update: {},
        create: {
            email: 'admin@example.com',
            password: hashedPassword,
            name: 'Admin User',
            role: 'ADMIN',
            businessUnit: 'CDG'
        }
    });

    console.log('✅ Created users');

    // Create sample products
    const products = [
        { code: 'P001', name: 'GelImager MP Imaging System', sapCode: 'SAP001', category: 'Equipment', unitPrice: 500000, wholesalePrice: 450000 },
        { code: 'P002', name: 'TC-100 Thermal Cycler', sapCode: 'SAP002', category: 'Equipment', unitPrice: 300000, wholesalePrice: 270000 },
        { code: 'P003', name: 'PowerUnit Basic Power Supply', sapCode: 'SAP003', category: 'Equipment', unitPrice: 50000, wholesalePrice: 45000 },
        { code: 'P004', name: 'Protein Assay Kit', sapCode: 'SAP004', category: 'Consumables', isConsumable: true, unitPrice: 15000, wholesalePrice: 13500 },
        { code: 'P005', name: 'PCR Tubes 200μL', sapCode: 'SAP005', category: 'Consumables', isConsumable: true, unitPrice: 5000, wholesalePrice: 4500 }
    ];

    for (const product of products) {
        await prisma.product.upsert({
            where: { code: product.code },
            update: {},
            create: product
        });
    }

    console.log('✅ Created products');

    // Create sample channel partners
    const channelPartners = [
        { code: '100001', name: 'Tokyo Scientific Supplies', address: '1-1-1 Shibuya, Tokyo', phone: '000-0000-0001', email: 'contact-497b33@outside.example' },
        { code: '100002', name: 'Osaka Lab Equipment Co.', address: '2-2-2 Umeda, Osaka', phone: '000-0000-0002', email: 'contact-d73d0c@outside.example' },
        { code: '100003', name: 'Kyoto Research Materials', address: '3-3-3 Kawaramachi, Kyoto', phone: '000-0000-0003', email: 'contact-45f4da@outside.example' }
    ];

    for (const partner of channelPartners) {
        await prisma.channelPartner.upsert({
            where: { code: partner.code },
            update: {},
            create: partner
        });
    }

    console.log('✅ Created channel partners');

    // Create sample end users
    const endUsers = [
        { code: '800001', name: 'Tokyo University Research Lab', address: '7-3-1 Hongo, Bunkyo-ku, Tokyo', phone: '000-0000-0004', email: 'contact-7b2046@outside.example' },
        { code: '800002', name: 'Osaka Medical Center', address: '1-8-1 Tennoji, Osaka', phone: '000-0000-0005', email: 'contact-80e8dc@outside.example' },
        { code: '800003', name: 'Kyoto Institute of Technology', address: 'Matsugasaki, Sakyo-ku, Kyoto', phone: '000-0000-0006', email: 'contact-ca3ba1@outside.example' }
    ];

    for (const endUser of endUsers) {
        await prisma.endUser.upsert({
            where: { code: endUser.code },
            update: {},
            create: endUser
        });
    }

    console.log('✅ Created end users');

    console.log('🎉 Database seed completed!');
    console.log('\n📝 Sample credentials:');
    console.log('   Requester: requester@example.com / password123');
    console.log('   Sales Manager: sales.manager@example.com / password123');
    console.log('   District Manager: district.manager@example.com / password123');
    console.log('   National Manager: national.manager@example.com / password123');
    console.log('   Finance Controller: finance.controller@example.com / password123');
    console.log('   Director: director@example.com / password123');
    console.log('   Admin: admin@example.com / password123');
}

main()
    .catch((e) => {
        console.error('❌ Seed failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
