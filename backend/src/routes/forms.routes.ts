import { Router } from 'express';
import {
    getForms,
    getFormById,
    createForm,
    copyFormFromRejected,
    updateForm,
    deleteForm,
    submitForm,
    setSalesOrderNumber
, revertReviewEdits, reopenForm } from '../controllers/forms.controller';
import {
    listFormAttachmentsHandler,
    uploadFormAttachmentHandler,
    downloadFormAttachmentHandler,
    deleteFormAttachmentHandler,
} from '../controllers/form-attachments.controller';
import { authenticate, requireProvisionedUser } from '../middleware/auth.middleware';
import { forbidCustomerSupportWrites } from '../middleware/forbid-customer-support-write.middleware';
import { uploadFormAttachment } from '../middleware/upload-attachment.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);
router.use(requireProvisionedUser);

router.get('/', getForms);
router.get('/:id', getFormById);
router.post('/', forbidCustomerSupportWrites, createForm);
router.put('/:id', forbidCustomerSupportWrites, updateForm);
router.delete('/:id', forbidCustomerSupportWrites, deleteForm);
router.post('/:id/copy-from-rejected', forbidCustomerSupportWrites, copyFormFromRejected);
router.post('/:id/submit', forbidCustomerSupportWrites, submitForm);
// A rejected return back to its requester for correction, keeping its reference number and history.
router.post('/:id/reopen', forbidCustomerSupportWrites, reopenForm);
// Service Admin only, on a fully approved service return. See setSalesOrderNumber.
router.put('/:id/sales-order-number', forbidCustomerSupportWrites, setSalesOrderNumber);
// Service Admin only, while the return sits at its review step: undo every correction made there.
router.post('/:id/revert-review-edits', forbidCustomerSupportWrites, revertReviewEdits);

router.get('/:id/attachments', listFormAttachmentsHandler);
router.post(
    '/:id/attachments',
    forbidCustomerSupportWrites,
    uploadFormAttachment,
    uploadFormAttachmentHandler
);
router.get('/:id/attachments/:attachmentId', downloadFormAttachmentHandler);
router.delete(
    '/:id/attachments/:attachmentId',
    forbidCustomerSupportWrites,
    deleteFormAttachmentHandler
);

export default router;
