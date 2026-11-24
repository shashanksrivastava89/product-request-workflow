import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Link, NavLink, useNavigate } from 'react-router-dom'
import { MsalProvider } from '@azure/msal-react'
import './index.css'
import './styles/print.css'
import { I18nProvider, useI18n } from './providers/I18nContext'
import { FormProvider } from './providers/FormContext'
import { ReturnFormProvider } from './providers/ReturnFormContext'
import { AuthProvider, useAuth } from './providers/AuthContext'
import { getMsalInstance } from './auth/msalInstance'
import ProtectedRoute from './components/ProtectedRoute'
import ProtectedAdminRoute from './components/ProtectedAdminRoute'
import ProtectedStrictAdminRoute from './components/ProtectedStrictAdminRoute'
import Home from './pages/Home'
import ReturnHome from './pages/ReturnHome'
import ReturnNewForm from './pages/ReturnNewForm'
import ReturnSuccessPage from './pages/ReturnSuccessPage'
import NewForm from './pages/NewForm'
import SuccessPage from './pages/SuccessPage'
import FormLinkRedirect from './pages/FormLinkRedirect'
import Login from './pages/Login'
import PendingAccessPage from './pages/PendingAccessPage'
import SsoTestPage from './pages/SsoTestPage'
import InboxRoute from './components/InboxRoute'
import ApprovalInbox from './pages/ApprovalInbox'
import ReturnReviewEdit from './pages/ReturnReviewEdit'
import { applyDevSignInFromUrl, applyDevLogoutFromUrl } from './utils/devSignIn'
import MailboxChooser from './pages/MailboxChooser'
import { hasCustomerSupportView, hasSuperApproverAccess, isCustomerSupport } from './utils/user-roles'
import CustomerSupportRouteGuard from './components/CustomerSupportRouteGuard'
import CustomerSupportRequestsPage from './pages/CustomerSupportRequestsPage'
import { isUnprovisionedSsoUser } from './utils/sso-access'
import PendingApprovals from './pages/PendingApprovals'
import ApprovedRequests from './pages/ApprovedRequests'
import ZncClaimApprovedReportPage from './pages/ZncClaimApprovedReportPage'
import TokenApproval from './pages/TokenApproval'
import AdminLayout from './components/admin/AdminLayout'
import CustomerManagement from './pages/admin/CustomerManagement'
import ProductManagement from './pages/admin/ProductManagement'
import GlobalChangeHistory from './pages/admin/GlobalChangeHistory'
import HierarchyManagement from './pages/admin/HierarchyManagement'
import HierarchyUserDetail from './pages/admin/HierarchyUserDetail'
import BulkImportPage from './pages/admin/BulkImportPage'
import ProductReconciliationPage from './pages/admin/ProductReconciliationPage'
import CustomerReconciliationPage from './pages/admin/CustomerReconciliationPage'
import AdminUsersPage from './pages/admin/AdminUsersPage'
import RequesterDirectoryPage from './pages/admin/RequesterDirectoryPage'
import ApprovalMappingsPage from './pages/admin/ApprovalMappingsPage'
import SubmittedRequestsPage from './pages/admin/SubmittedRequestsPage'
import AppSettingsPage from './pages/admin/AppSettingsPage'

function Shell() {
  const { t } = useI18n()
  const { user, logout, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const hideMainNav = isUnprovisionedSsoUser(user)
  const supportUser = isCustomerSupport(user?.role)

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-white">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center">
            <img src="/acme-logo.svg" alt="Acme" className="h-8" />
          </Link>
          <nav className="flex items-center gap-2">
            {!hideMainNav && (
              <>
            {supportUser ? (
              <>
                <NavLink
                  to="/"
                  end
                  className={({ isActive }) =>
                    `flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                      isActive ? 'bg-[#00A651]/10 text-[#00A651]' : 'text-gray-700 hover:bg-gray-100'
                    }`
                  }
                >
                  <span>🏠</span>
                  <span>Home</span>
                </NavLink>
                <NavLink
                  to="/support/requests"
                  className={({ isActive }) =>
                    `flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                      isActive ? 'bg-[#0066CC]/10 text-[#0066CC]' : 'text-gray-700 hover:bg-gray-100'
                    }`
                  }
                >
                  <span>📋</span>
                  <span>Requests</span>
                </NavLink>
              </>
            ) : (
              <>
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                  isActive ? 'bg-[#00A651]/10 text-[#00A651]' : 'text-gray-700 hover:bg-gray-100'
                }`}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
              </svg>
              <span>Home</span>
            </NavLink>
            <NavLink
              to="/new"
              className={({ isActive }) =>
                `flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                  isActive ? 'bg-[#00A651]/10 text-[#00A651]' : 'text-gray-700 hover:bg-gray-100'
                }`}
            >
              <span>📝</span>
              <span>{t('nav.sample')}</span>
            </NavLink>
            <NavLink
              to="/return"
              className={({ isActive }) =>
                `flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                  isActive ? 'bg-[#00A651]/10 text-[#00A651]' : 'text-gray-700 hover:bg-gray-100'
                }`}
            >
              <span>↩️</span>
              <span>{t('nav.return')}</span>
            </NavLink>
            <NavLink
              to="/inbox"
              className={({ isActive }) =>
                `flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                  isActive ? 'bg-[#0066CC]/10 text-[#0066CC]' : 'text-gray-700 hover:bg-gray-100'
                }`}
            >
              <span>📬</span>
              <span>Inbox</span>
            </NavLink>
            <NavLink
              to="/pending"
              className={({ isActive }) =>
                `flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                  isActive ? 'bg-[#FF9500]/10 text-[#FF9500]' : 'text-gray-700 hover:bg-gray-100'
                }`}
            >
              <span>⏳</span>
              <span>Pending</span>
            </NavLink>
            <NavLink
              to="/approved"
              className={({ isActive }) =>
                `flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                  isActive ? 'bg-[#28A745]/10 text-[#28A745]' : 'text-gray-700 hover:bg-gray-100'
                }`}
            >
              <span>✅</span>
              <span>Approved</span>
            </NavLink>
            {/* The Customer Service view on top of an ordinary role (the role-only layout is the branch above). */}
            {hasCustomerSupportView(user?.role, user?.isCustomerSupport) && (
              <NavLink
                to="/support/requests"
                className={({ isActive }) =>
                  `flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                    isActive ? 'bg-[#0066CC]/10 text-[#0066CC]' : 'text-gray-700 hover:bg-gray-100'
                  }`}
              >
                <span>📋</span>
                <span>Requests</span>
              </NavLink>
            )}
            {(user?.role === 'ADMIN' || hasSuperApproverAccess(user?.role, user?.isSuperApprover)) && (
              <NavLink
                to={user?.role === 'ADMIN' ? '/admin/customers' : '/admin/requests'}
                className={({ isActive }) =>
                  `flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                    isActive ? 'bg-[#00A651]/10 text-[#00A651]' : 'text-gray-700 hover:bg-gray-100'
                  }`}
              >
                <span>⚙️</span>
                <span>Data Mgmt</span>
              </NavLink>
            )}
              </>
            )}
              </>
            )}
          </nav>
          <div className="flex items-center gap-4 text-sm">
            {isAuthenticated && user && (
              <div className="flex items-center gap-4">
                <span className="text-gray-700">
                  {t('app.welcome')}, <strong>{user.name}</strong>
                </span>
                <button
                  onClick={handleLogout}
                  className="px-3 py-1 text-red-600 hover:text-red-800 hover:bg-red-50 rounded transition-colors"
                >
                  {t('app.logout')}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1">
        <CustomerSupportRouteGuard>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/pending-access"
            element={
              <ProtectedRoute>
                <PendingAccessPage />
              </ProtectedRoute>
            }
          />
          <Route path="/sso-test" element={<SsoTestPage />} />
          <Route path="/approval/approve" element={<TokenApproval />} />
          <Route path="/approval/reject" element={<TokenApproval />} />
          <Route path="/approval/view" element={<TokenApproval />} />
          <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />
          <Route path="/new" element={<ProtectedRoute><NewForm /></ProtectedRoute>} />
          <Route path="/return" element={<ProtectedRoute><ReturnHome /></ProtectedRoute>} />
          <Route path="/return/new" element={<ProtectedRoute><ReturnNewForm /></ProtectedRoute>} />
          <Route path="/return/success" element={<ProtectedRoute><ReturnSuccessPage /></ProtectedRoute>} />
          {/* The Return section reuses the three mature approval pages with scope="return" instead of
              its own copies. The old ReturnInbox / ReturnPending / ReturnApproved were 31-line
              placeholders, so a submitted return appeared only in the Sample lists — reported from
              UAT as "it only appeared in Sample Request mailbox not in Return". */}
          <Route path="/return/inbox" element={<ProtectedRoute><InboxRoute scope="return" /></ProtectedRoute>} />
          {/* The P&OP service review queue, reachable from the Review card on the return home page.
              Routed straight to ApprovalInbox rather than through InboxRoute on purpose: a super
              approver would otherwise get the table view, and reviewing needs the row-by-row detail,
              product lines and print sheet that ApprovalInbox provides. Who may see a review step at
              all is decided by the server. */}
          <Route path="/return/review" element={<ProtectedRoute><ApprovalInbox scope="return" onlyReviewSteps /></ProtectedRoute>} />
          {/* Correct a request during the review window. The server enforces who may, and when. */}
          <Route path="/return/edit/:id" element={<ProtectedRoute><ReturnReviewEdit /></ProtectedRoute>} />
          <Route path="/return/pending" element={<ProtectedRoute><PendingApprovals scope="return" /></ProtectedRoute>} />
          <Route path="/return/approved" element={<ProtectedRoute><ApprovedRequests scope="return" /></ProtectedRoute>} />
          <Route path="/success" element={<ProtectedRoute><SuccessPage /></ProtectedRoute>} />
          {/* The address older mails link to - every sample rejection since go-live, and return
              rejections sent before the link changed. It looks the request up and opens it on the
              list that holds it. See FormLinkRedirect. */}
          <Route path="/forms/:id" element={<ProtectedRoute><FormLinkRedirect /></ProtectedRoute>} />
          {/* Top-nav entries: ask which section, then hand off to the routes below. The
              section routes stay exactly as they were so home tiles and old links still work. */}
          <Route path="/inbox" element={<ProtectedRoute><MailboxChooser kind="inbox" /></ProtectedRoute>} />
          <Route path="/pending" element={<ProtectedRoute><MailboxChooser kind="pending" /></ProtectedRoute>} />
          <Route path="/approved" element={<ProtectedRoute><MailboxChooser kind="approved" /></ProtectedRoute>} />

          <Route path="/approvals/inbox" element={<ProtectedRoute><InboxRoute /></ProtectedRoute>} />
          <Route path="/approvals/pending" element={<ProtectedRoute><PendingApprovals /></ProtectedRoute>} />
          <Route path="/approvals/approved" element={<ProtectedRoute><ApprovedRequests /></ProtectedRoute>} />
          <Route
            path="/reports/znc-claim-approved"
            element={
              <ProtectedRoute>
                <ZncClaimApprovedReportPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/support/requests"
            element={
              <ProtectedRoute>
                <CustomerSupportRequestsPage />
              </ProtectedRoute>
            }
          />
          {/* Admin Routes */}
          <Route path="/admin" element={<ProtectedAdminRoute><AdminLayout /></ProtectedAdminRoute>}>
            <Route path="customers" element={<ProtectedStrictAdminRoute><CustomerManagement /></ProtectedStrictAdminRoute>} />
            <Route path="products" element={<ProtectedStrictAdminRoute><ProductManagement /></ProtectedStrictAdminRoute>} />
            <Route path="change-history" element={<ProtectedStrictAdminRoute><GlobalChangeHistory /></ProtectedStrictAdminRoute>} />
            <Route path="hierarchy" element={<ProtectedStrictAdminRoute><HierarchyManagement /></ProtectedStrictAdminRoute>} />
            <Route path="hierarchy/user/:id" element={<ProtectedStrictAdminRoute><HierarchyUserDetail /></ProtectedStrictAdminRoute>} />
            <Route path="users" element={<ProtectedStrictAdminRoute><AdminUsersPage /></ProtectedStrictAdminRoute>} />
            <Route path="requesters" element={<ProtectedStrictAdminRoute><RequesterDirectoryPage /></ProtectedStrictAdminRoute>} />
            <Route path="bulk-import" element={<ProtectedStrictAdminRoute><BulkImportPage /></ProtectedStrictAdminRoute>} />
            <Route path="product-reconciliation" element={<ProtectedStrictAdminRoute><ProductReconciliationPage /></ProtectedStrictAdminRoute>} />
            <Route path="customer-reconciliation" element={<ProtectedStrictAdminRoute><CustomerReconciliationPage /></ProtectedStrictAdminRoute>} />
            <Route path="approval-mappings" element={<ProtectedStrictAdminRoute><ApprovalMappingsPage /></ProtectedStrictAdminRoute>} />
            <Route path="requests" element={<SubmittedRequestsPage />} />
            <Route path="app-settings" element={<ProtectedStrictAdminRoute><AppSettingsPage /></ProtectedStrictAdminRoute>} />
          </Route>
        </Routes>
        </CustomerSupportRouteGuard>
      </main>
    </div>
  )
}

const msalInstance = getMsalInstance()

const appTree = (
  <React.StrictMode>
    <I18nProvider>
      {msalInstance ? (
        <MsalProvider instance={msalInstance}>
          <AuthProvider msalInstance={msalInstance}>
            <FormProvider>
              <ReturnFormProvider>
                <BrowserRouter>
                  <Shell />
                </BrowserRouter>
              </ReturnFormProvider>
            </FormProvider>
          </AuthProvider>
        </MsalProvider>
      ) : (
        <AuthProvider>
          <FormProvider>
            <ReturnFormProvider>
              <BrowserRouter>
                <Shell />
              </BrowserRouter>
            </ReturnFormProvider>
          </FormProvider>
        </AuthProvider>
      )}
    </I18nProvider>
  </React.StrictMode>
)

const root = document.getElementById('root')!

// Local development only: ?devUser=<email> signs in without the Microsoft round trip, and
// ?devLogout clears it. Both are compiled out of a production build. Must run before the first
// render, because AuthContext reads localStorage as it mounts.
applyDevLogoutFromUrl()
applyDevSignInFromUrl()

void (msalInstance ? msalInstance.initialize() : Promise.resolve()).then(() => {
  ReactDOM.createRoot(root).render(appTree)
})
