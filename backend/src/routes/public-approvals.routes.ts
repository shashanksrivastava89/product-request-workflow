/**
 * Public approval routes (no authentication required)
 * These routes handle token-based approval from email links
 */

import express from 'express';
import {
    getApprovalByToken,
    approveFormByToken,
    rejectFormByToken,
    listAttachmentsByToken,
    downloadAttachmentByToken,
} from '../controllers/public-approvals.controller';

const router = express.Router();

// Get approval details by token
router.get('/token', getApprovalByToken);

// Attachment access for token approvers
router.get('/attachments', listAttachmentsByToken);
router.get('/attachments/:attachmentId', downloadAttachmentByToken);

// Approve form by token
router.post('/approve', approveFormByToken);

// Reject form by token
router.post('/reject', rejectFormByToken);

export default router;

