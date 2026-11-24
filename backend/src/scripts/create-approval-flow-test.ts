import bcrypt from 'bcrypt';
import { db, User, SalesForm, FormProduct } from '../services/db.service';

/**
 * Create a complete approval flow test scenario
 * This creates users following the approval hierarchy and a test form
 */
async function createApprovalFlowTest() {
    console.log('🎯 Creating Complete Approval Flow Test Scenario\n');

    const DUMMY_PASSWORD = 'acme123';
    const hashedPassword = await bcrypt.hash(DUMMY_PASSWORD, 10);

    // Based on approval hierarchy for LONNIE DUNGAN
    // Flow: Requester → Sales Manager → District Manager → National Manager → Finance Controller → Director

    console.log('👥 Creating Test Users for Complete Approval Flow:\n');

    // 1. REQUESTER
    const requester = db.create<User>('users', {
        email: 'lonnie.dungan@example.com',
        password: hashedPassword,
        name: 'LONNIE DUNGAN',
        role: 'REQUESTER',
        businessUnit: 'CDG',
        salesRepCode: 'SR100',
        requesterGroupId: 'RG100',
        salesManager: 'SAMARTH LEENEY',
        districtSalesManager: 'ZION MORTIMER',
        nationalSalesManager: 'CAILUM CORTEZ',
        localFinanceController: 'ROBERTA MILEY',
        directorCommercialManager: 'DEVON COMYN',
        isActive: true
    } as any);
    console.log('✅ 1. Requester: LONNIE DUNGAN (lonnie.dungan@example.com)');

    // 2. SALES MANAGER (Level 1 Approver)
    const salesManager = db.create<User>('users', {
        email: 'samarth.leeney@example.com',
        password: hashedPassword,
        name: 'SAMARTH LEENEY',
        role: 'SALES_MANAGER',
        businessUnit: 'CDG',
        isActive: true
    } as any);
    console.log('✅ 2. Sales Manager (L1): SAMARTH LEENEY (samarth.leeney@example.com)');

    // 3. DISTRICT SALES MANAGER (Level 2 Approver)
    const districtManager = db.create<User>('users', {
        email: 'zion.mortimer@example.com',
        password: hashedPassword,
        name: 'ZION MORTIMER',
        role: 'DISTRICT_SALES_MANAGER',
        businessUnit: 'CDG',
        isActive: true
    } as any);
    console.log('✅ 3. District Sales Manager (L2): ZION MORTIMER (zion.mortimer@example.com)');

    // 4. NATIONAL SALES MANAGER (Level 3 Approver)
    const nationalManager = db.create<User>('users', {
        email: 'cailum.cortez@example.com',
        password: hashedPassword,
        name: 'CAILUM CORTEZ',
        role: 'NATIONAL_SALES_MANAGER',
        businessUnit: 'CDG',
        isActive: true
    } as any);
    console.log('✅ 4. National Sales Manager (L3): CAILUM CORTEZ (cailum.cortez@example.com)');

    // 5. FINANCE CONTROLLER (Level 4 Approver - for amounts > ¥3,000,000)
    const financeController = db.create<User>('users', {
        email: 'roberta.miley@example.com',
        password: hashedPassword,
        name: 'ROBERTA MILEY',
        role: 'FINANCE_CONTROLLER',
        businessUnit: 'CDG',
        isActive: true
    } as any);
    console.log('✅ 5. Finance Controller (L4): ROBERTA MILEY (roberta.miley@example.com)');

    // 6. DIRECTOR COMMERCIAL (Level 5 Approver - for amounts > ¥3,000,000)
    const director = db.create<User>('users', {
        email: 'devon.comyn@example.com',
        password: hashedPassword,
        name: 'DEVON COMYN',
        role: 'DIRECTOR_COMMERCIAL',
        businessUnit: 'CDG',
        isActive: true
    } as any);
    console.log('✅ 6. Director Commercial (L5): DEVON COMYN (devon.comyn@example.com)');

    // Suppress unused variable warnings
    void salesManager;
    void districtManager;
    void nationalManager;
    void financeController;
    void director;

    console.log('\n📋 Creating Test Form (ZSAM with ¥5,000,000 - triggers all 5 approval levels):\n');

    // Create a ZSAM form with amount > ¥3,000,000 to trigger all approval levels
    const form = db.create<SalesForm>('salesForms', {
        formType: 'ZSAM',
        requesterId: requester.id,
        requesterName: requester.name,
        salesRepCodeSap: 'SR100',
        businessUnit: 'CDG',
        requesterGroup: 'RG100',
        requestDate: new Date().toISOString(),
        expectedDeliveryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        purpose: 'Complete approval flow test - High value ZSAM order',
        deliveryMode: 'Direct Delivery',
        soldToCode: '100001',
        soldToName: 'Tokyo Scientific Supplies',
        shipToCode: '100001',
        shipToName: 'Tokyo Scientific Supplies',
        endUserCode: '800001',
        endUserName: 'Tokyo University Research Lab',
        address: '7-3-1 Hongo, Bunkyo-ku, Tokyo',
        salesManager: 'SAMARTH LEENEY',
        districtSalesManager: 'ZION MORTIMER',
        nationalSalesManager: 'CAILUM CORTEZ',
        localFinanceController: 'ROBERTA MILEY',
        directorCommercialManager: 'DEVON COMYN',
        commentsForApproval: 'High-value equipment order for university research lab. All approvals required.',
        freeDescription: 'Complete imaging system package with accessories',
        totalAmount: 5000000, // ¥5,000,000 - triggers all approval levels
        currency: 'JPY',
        status: 'DRAFT',
        referenceNumber: 'TEST-FLOW-001'
    } as any);

    console.log(`✅ Form Created: ${form.referenceNumber}`);
    console.log(`   Type: ${form.formType}`);
    console.log(`   Amount: ¥${form.totalAmount.toLocaleString()}`);
    console.log(`   Status: ${form.status}`);

    // Add products to the form
    const products = [
        {
            formId: form.id,
            productCode: 'P001',
            productName: 'GelImager MP Imaging System',
            sapCode: 'SAP001',
            quantity: 1,
            unitPrice: 3500000,
            wholesalePrice: 3150000,
            subtotal: 3500000,
            isConsumable: false,
            note: 'Main imaging system'
        },
        {
            formId: form.id,
            productCode: 'P002',
            productName: 'TC-100 Thermal Cycler',
            sapCode: 'SAP002',
            quantity: 2,
            unitPrice: 500000,
            wholesalePrice: 450000,
            subtotal: 1000000,
            isConsumable: false,
            note: 'Thermal cyclers for PCR'
        },
        {
            formId: form.id,
            productCode: 'P004',
            productName: 'Protein Assay Kit',
            sapCode: 'SAP004',
            quantity: 10,
            unitPrice: 50000,
            wholesalePrice: 45000,
            subtotal: 500000,
            isConsumable: true,
            note: 'Consumable supplies'
        }
    ];

    products.forEach(product => {
        db.create<FormProduct>('formProducts', product as any);
    });

    console.log(`\n✅ Added ${products.length} products to form`);

    console.log('\n' + '='.repeat(80));
    console.log('🎉 APPROVAL FLOW TEST SCENARIO CREATED SUCCESSFULLY!');
    console.log('='.repeat(80));

    console.log('\n📝 LOGIN CREDENTIALS (All passwords: acme123):\n');
    console.log('1️⃣  REQUESTER:');
    console.log('   Email: lonnie.dungan@example.com');
    console.log('   Role: Submit the form to start the approval flow\n');

    console.log('2️⃣  SALES MANAGER (Level 1 Approver):');
    console.log('   Email: samarth.leeney@example.com');
    console.log('   Role: First approval in the chain\n');

    console.log('3️⃣  DISTRICT SALES MANAGER (Level 2 Approver):');
    console.log('   Email: zion.mortimer@example.com');
    console.log('   Role: Second approval in the chain\n');

    console.log('4️⃣  NATIONAL SALES MANAGER (Level 3 Approver):');
    console.log('   Email: cailum.cortez@example.com');
    console.log('   Role: Third approval in the chain\n');

    console.log('5️⃣  FINANCE CONTROLLER (Level 4 Approver):');
    console.log('   Email: roberta.miley@example.com');
    console.log('   Role: Fourth approval (triggered by amount > ¥3M)\n');

    console.log('6️⃣  DIRECTOR COMMERCIAL (Level 5 Approver):');
    console.log('   Email: devon.comyn@example.com');
    console.log('   Role: Final approval (triggered by amount > ¥3M)\n');

    console.log('='.repeat(80));
    console.log('📋 TEST FLOW STEPS:');
    console.log('='.repeat(80));
    console.log('1. Login as LONNIE DUNGAN (requester)');
    console.log('2. Navigate to form TEST-FLOW-001 and submit it');
    console.log('3. Login as SAMARTH LEENEY (Sales Manager) → Approve');
    console.log('4. Login as ZION MORTIMER (District Manager) → Approve');
    console.log('5. Login as CAILUM CORTEZ (National Manager) → Approve');
    console.log('6. Login as ROBERTA MILEY (Finance Controller) → Approve');
    console.log('7. Login as DEVON COMYN (Director) → Final Approve');
    console.log('8. Login back as LONNIE DUNGAN to see approved form');
    console.log('='.repeat(80));

    console.log('\n💡 TIP: You can also test rejection at any level to see the flow stop');
    console.log('💡 TIP: Check "Pending Approvals" as requester to track progress');
    console.log('💡 TIP: Each approver will see the form in their "Approval Inbox"\n');
}

// Run the script
createApprovalFlowTest()
    .then(() => {
        console.log('✨ Script completed successfully!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Error creating test scenario:', error);
        process.exit(1);
    });
