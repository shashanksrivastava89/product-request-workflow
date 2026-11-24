/**
 * Admin Routes
 * All routes require ADMIN role
 */

import { Router } from 'express';
import {
  authenticate,
  authorize,
  requireSecureImportAuth,
  requireProvisionedUser,
} from '../middleware/auth.middleware';
import {
  getCustomers,
  exportCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  restoreCustomer,
  getCustomerHistory,
  getCustomerVersion,
  rollbackCustomer,
} from '../controllers/customer-management.controller';
import {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  restoreProduct,
  getProductHistory,
  getProductVersion,
  rollbackProduct,
  bulkUpdateProducts,
} from '../controllers/product-management.controller';
import {
  applyRunHandler,
  createPreview,
  downloadRunFileHandler,
  exportCurrentProductsHandler,
  exportRunRowsHandler,
  getRunHandler,
  getRunHistoryHandler,
  getRunRowsHandler,
  listRunsHandler,
  listVersionsHandler,
  restoreRunHandler,
} from '../controllers/product-sync.controller';
import {
  compareCustomers,
  disableCustomers,
} from '../controllers/customer-reconciliation.controller';
import { getChangeHistory } from '../controllers/change-history.controller';
import {
  getHierarchyList,
  getHierarchyTree,
  getUserHierarchyDetails,
  updateUserHierarchy,
  getUserSubordinates,
  validateHierarchies,
  validateHierarchy,
  getCircularReferences,
  getMissingApprovers,
} from '../controllers/hierarchy-management.controller';
import { uploadImportChunk, uploadImportFile } from '../middleware/upload.middleware';
import { validateImportUpload } from '../middleware/validate-import-upload.middleware';
import {
  validateImport,
  sheetInfo,
  executeImport,
  beginChunkedUpload,
  appendChunkedUpload,
  finalizeChunkedUpload,
  abortChunkedUpload,
  statusChunkedUpload,
} from '../controllers/import.controller';
import {
  listRequesterGroups,
  searchRequesterGroupsForPicker,
  createRequesterGroup,
  updateRequesterGroup,
  deleteRequesterGroup,
  listRequesters,
  searchRequestersForPicker,
  createRequester,
  updateRequester,
  deleteRequester,
} from '../controllers/requester-management.controller';
import {
  exportReturnApprovalMatrix,
  listApprovalMappings,
  getApprovalMapping,
  getApprovalMappingSummary,
  createApprovalMapping,
  updateApprovalMapping,
  deleteApprovalMapping,
} from '../controllers/approval-mapping.controller';
import { listAdminForms } from '../controllers/admin-forms.controller';
import {
  previewPersonOffboarding,
  executePersonOffboarding,
} from '../controllers/people-offboarding.controller';
import { putWizardStep2DataBanner } from '../controllers/app-settings.controller';
import {
  listAdminUsers,
  listUsersForApprovalPicker,
  createAdminUser,
  patchAdminUser,
  exportAdminUsersCsv,
} from '../controllers/admin-users.controller';

const router = Router();

router.use(authenticate);
router.use(requireProvisionedUser);

// Submitted sample requests — ADMIN + SUPER_APPROVER (list/filter)
router.get('/forms', authorize('ADMIN', 'SUPER_APPROVER'), listAdminForms);

// All other admin routes require ADMIN role only
router.use(authorize('ADMIN'));

// Customer Management Routes
router.get('/customers', getCustomers);
router.get('/customers/export', exportCustomers);
router.post(
  '/customers/reconcile/compare',
  requireSecureImportAuth,
  uploadImportFile,
  validateImportUpload,
  compareCustomers
);
router.post('/customers/reconcile/disable', disableCustomers);
router.get('/customers/:id', getCustomer);
router.post('/customers', createCustomer);
router.put('/customers/:id', updateCustomer);
router.delete('/customers/:id', deleteCustomer);
router.post('/customers/:id/restore', restoreCustomer);
router.get('/customers/:id/history', getCustomerHistory);
router.get('/customers/:id/history/:version', getCustomerVersion);
router.post('/customers/:id/rollback', rollbackCustomer);

// Product Management Routes
router.get('/products', getProducts);
// Acts on every row matching the grid's filter, not just the page the browser loaded.
router.post('/products/bulk-update', bulkUpdateProducts);
router.get('/products/:id', getProduct);
router.post('/products', createProduct);
router.put('/products/:id', updateProduct);
router.delete('/products/:id', deleteProduct);
router.post('/products/:id/restore', restoreProduct);
router.get('/products/:id/history', getProductHistory);
router.get('/products/:id/history/:version', getProductVersion);
router.post('/products/:id/rollback', rollbackProduct);

// Change History / Audit Log Routes
router.get('/change-history', getChangeHistory);

// Hierarchy Management Routes
router.get('/hierarchy', getHierarchyList);
router.get('/hierarchy/tree', getHierarchyTree);
router.get('/hierarchy/user/:id', getUserHierarchyDetails);
router.put('/hierarchy/user/:id', updateUserHierarchy);
router.get('/hierarchy/user/:id/subordinates', getUserSubordinates);
router.get('/hierarchy/validate', validateHierarchies);
router.post('/hierarchy/validate', validateHierarchy);
router.get('/hierarchy/circular', getCircularReferences);
router.get('/hierarchy/missing-approvers', getMissingApprovers);

// Requester groups & requesters (New Application directory)
router.get('/requester-groups/picker', searchRequesterGroupsForPicker);
router.get('/requester-groups', listRequesterGroups);
router.post('/requester-groups', createRequesterGroup);
router.put('/requester-groups/:id', updateRequesterGroup);
router.delete('/requester-groups/:id', deleteRequesterGroup);
router.get('/requesters/search', searchRequestersForPicker);
router.get('/requesters', listRequesters);
router.post('/requesters', createRequester);
router.put('/requesters/:id', updateRequester);
router.delete('/requesters/:id', deleteRequester);

// Approval mapping tables (ZSAM, ZNC Install, ZNC Claim, ZINT) — same data as bulk hierarchy import
router.get('/approval-mappings/summary', getApprovalMappingSummary);
// Before the :formType route, or "return" would be read as a form type and "export" as an id.
router.get('/approval-mappings/return/export', exportReturnApprovalMatrix);
router.get('/approval-mappings/:formType', listApprovalMappings);
router.get('/approval-mappings/:formType/:id', getApprovalMapping);
router.post('/approval-mappings/:formType', createApprovalMapping);
router.put('/approval-mappings/:formType/:id', updateApprovalMapping);
router.delete('/approval-mappings/:formType/:id', deleteApprovalMapping);

// A person who left: everywhere their name steers an approval (preview), then the removal itself
router.get('/people/offboarding', previewPersonOffboarding);
router.post('/people/offboarding', executePersonOffboarding);

// App UI copy (wizard step 2 banner text)
router.put('/app-settings/wizard-step2-data-banner', putWizardStep2DataBanner);

// Administrator accounts (role ADMIN)
router.get('/users/approval-picker', listUsersForApprovalPicker);
router.get('/users/export', exportAdminUsersCsv);
router.get('/users', listAdminUsers);
router.post('/users', createAdminUser);
router.patch('/users/:id', patchAdminUser);

// Bulk Import: validate (Phase 1), then execute upsert (Phase 2)
router.post('/import/sheet-info', requireSecureImportAuth, uploadImportFile, validateImportUpload, sheetInfo);
router.post('/import/validate', requireSecureImportAuth, uploadImportFile, validateImportUpload, validateImport);
router.post('/import/execute', requireSecureImportAuth, uploadImportFile, validateImportUpload, executeImport);

// Product master sync: preview a staged export as a run, inspect it, apply it. The upload reuses
// the chunked staging above, so the 8KB edge limit never sees a whole file.
router.get('/product-sync/export', exportCurrentProductsHandler);
router.post('/product-sync/runs', requireSecureImportAuth, uploadImportFile, validateImportUpload, createPreview);
router.get('/product-sync/runs', listRunsHandler);
router.get('/product-sync/runs/:id', getRunHandler);
router.get('/product-sync/runs/:id/rows', getRunRowsHandler);
router.get('/product-sync/runs/:id/export', exportRunRowsHandler);
router.get('/product-sync/runs/:id/history', getRunHistoryHandler);
router.get('/product-sync/runs/:id/file', downloadRunFileHandler);
router.post('/product-sync/runs/:id/apply', applyRunHandler);
router.post('/product-sync/runs/:id/restore', restoreRunHandler);
router.get('/product-sync/versions', listVersionsHandler);

// Chunked upload: the browser slices the file so no single request body exceeds the edge's limit
// (~8KB on UAT/production), then validate/execute run against the reassembled file via uploadId.
router.post('/import/chunk/begin', requireSecureImportAuth, beginChunkedUpload);
router.post('/import/chunk', requireSecureImportAuth, uploadImportChunk, appendChunkedUpload);
router.post('/import/chunk/finalize', requireSecureImportAuth, finalizeChunkedUpload);
router.post('/import/chunk/status', requireSecureImportAuth, statusChunkedUpload);
router.post('/import/chunk/abort', requireSecureImportAuth, abortChunkedUpload);

export default router;
