import { Request, Response } from 'express';
import { sendEmail } from '../services/email.service';

export const sendDemoEmail = async (req: Request, res: Response) => {
    try {
        const { to } = req.body;

        if (!to) {
            return res.status(400).json({ error: 'Email address (to) is required' });
        }

        // Comprehensive dummy data with delivery and products
        const demoData = {
            approverName: 'Demo Approver',
            formId: 'DEMO-123',
            formType: 'ZSAM',
            requesterName: 'Demo Requester',
            requesterDisplay: 'Demo Requester (9000000)',
            totalAmount: 2500000,
            requestDate: new Date(),
            level: 1,
            role: 'Sales Manager',
            // Delivery Information
            soldToName: 'Meditech Corporation',
            soldToCode: '1089602',
            shipToName: 'HEIWAJAMA SERVICE CENTER',
            shipToCode: 'HEIWA',
            endUserName: 'Tokyo Medical Hospital',
            endUserCode: '8000001',
            deliveryMode: 'CHANNEL',
            // Products
            products: [
                {
                    productName: 'MPX ANA Screen 100 Tests',
                    productCode: '33001',
                    sapCode: '6651150',
                    quantity: 5,
                    unitPrice: 96000,
                    subtotal: 480000
                },
                {
                    productName: 'MPX CALIBRATOR SET',
                    productCode: '33322',
                    sapCode: '6631101',
                    quantity: 10,
                    unitPrice: 56000,
                    subtotal: 560000
                },
                {
                    productName: 'MultiPlex EBV IgG 100 tests',
                    productCode: '33413',
                    sapCode: '6651250',
                    quantity: 8,
                    unitPrice: 96000,
                    subtotal: 768000
                }
            ]
        };

        await sendEmail({
            to,
            subject: 'Demo Approval Request - Full Details',
            template: 'approval-request-en',
            data: demoData
        });

        return res.status(200).json({
            message: `Demo email sent to ${to}`,
            preview: {
                recipient: to,
                formType: demoData.formType,
                totalAmount: `¥${demoData.totalAmount.toLocaleString()}`,
                products: demoData.products.length,
                hasDeliveryInfo: true
            }
        });
    } catch (error) {
        console.error('Error sending demo email:', error);
        return res.status(500).json({ error: 'Failed to send demo email' });
    }
};
