import React, { createContext, useContext, useMemo, useState } from 'react'

type Lang = 'en' | 'ja'

type Dict = Record<string, Record<Lang, string>>

const dict: Dict = {
  'app.title': { en: 'Acme', ja: 'アクメ' },
  'app.language': { en: 'Language', ja: '言語' },
  'app.logout': { en: 'Logout', ja: 'ログアウト' },
  'app.welcome': { en: 'Welcome', ja: 'ようこそ' },

  // Home page
  'home.title': { en: 'Welcome', ja: 'ようこそ' },
  'home.subtitle': { en: 'Create and submit requests', ja: '販売申請を作成・提出' },
  'home.cta': { en: 'Start New Application', ja: '新規申請を開始' },
  'home.approvalInbox': { en: "Approver's Inbox", ja: '承認受信箱' },
  'home.superApproverInbox': { en: 'Super approver inbox', ja: 'スーパー承認者受信箱' },
  'home.pendingApprovals': { en: 'Pending Approvals', ja: '保留中の承認' },

  // Login page
  'login.title': { en: 'Sign In', ja: 'サインイン' },
  'login.subtitle': { en: 'Sign in to your account', ja: 'アカウントにサインイン' },
  'login.email': { en: 'Email Address', ja: 'メールアドレス' },
  'login.emailPlaceholder': { en: 'ortega@example.com', ja: 'ortega@example.com' },
  'login.password': { en: 'Password', ja: 'パスワード' },
  'login.passwordPlaceholder': { en: 'Enter your password', ja: 'パスワードを入力' },
  'login.submit': { en: 'Sign In', ja: 'サインイン' },
  'login.loggingIn': { en: 'Signing in...', ja: 'サインイン中...' },
 
  'login.microsoft': { en: 'Sign in with Microsoft', ja: 'Microsoft でサインイン' },
  
  'pendingAccess.title': { en: 'No application access yet', ja: 'アプリケーションへのアクセスがありません' },
  'pendingAccess.body': {
    en: 'You are signed in with Microsoft, but this application does not have a user profile for your account yet.',
    ja: 'Microsoft でサインイン済みですが、このアプリケーションにユーザー登録がありません。',
  },
  'pendingAccess.signedInAs': { en: 'Signed in as', ja: 'サインイン中' },
  'pendingAccess.contact': {
    en: 'Please contact your administrator to add your email to the system. After that, sign out and sign in again.',
    ja: '管理者に連絡し、アカウントを追加してもらってください。追加後、一度サインアウトしてから再度サインインしてください。',
  },
  'pendingAccess.adminHint': {
    en: 'Administrators: the Users list must include a row whose email matches your Microsoft sign-in (or the server SSO_EMAIL_MAP must map your UPN to that email).',
    ja: '管理者向け: ユーザー一覧のメールが Microsoft サインインと一致している必要があります（またはサーバーの SSO_EMAIL_MAP で UPN を紐付け）。',
  },

  // Approval Inbox
  'approvals.inbox.title': { en: "Approver's Inbox", ja: '承認受信箱' },
  'approvals.inbox.subtitle': { en: 'Forms pending your approval', ja: '承認待ちのフォーム' },
  'approvals.inbox.empty': { en: 'No pending approvals', ja: '保留中の承認はありません' },
  'approvals.inbox.approve': { en: 'Approve', ja: '承認' },
  'approvals.inbox.reject': { en: 'Reject', ja: '却下' },
  'approvals.inbox.reopen': { en: 'Reopen step (same form)', ja: 'ステップを再開（同一フォーム）' },
  /** Compact label on inbox card header (after reference). */
  'approvals.inbox.reopenShort': { en: 'Reopen', ja: '再開' },
  'approvals.inbox.reopenHint': {
    en: 'This request was rejected here. Reopen to put it back in your inbox so you can approve or reject again.',
    ja: 'この申請はここで却下されました。再開すると受信箱に戻り、再度承認または却下できます。',
  },
  /** A rejected request's "Delete": out of this person's inbox only, the request itself is kept. */
  'approvals.inbox.deleteShort': { en: 'Delete', ja: '削除' },
  'approvals.inbox.deleteHint': {
    en: 'Delete removes it from your inbox only. The request is kept, and super approvers can still see it.',
    ja: '削除すると、あなたの受信箱からのみ消えます。申請自体は残り、スーパー承認者は引き続き閲覧できます。',
  },
  'approvals.inbox.deleteConfirm': {
    en: 'Delete this rejected request from your inbox?\n\nThe request itself is kept, and super approvers can still see it.',
    ja: 'この却下済みの申請を受信箱から削除しますか？\n\n申請自体は残り、スーパー承認者は引き続き閲覧できます。',
  },
  'approvals.inbox.comments': { en: 'Comments', ja: 'コメント' },
  'approvals.inbox.commentsPlaceholder': { en: 'Add your comments...', ja: 'コメントを追加...' },

  // Pending Approvals
  'approvals.pending.title': { en: 'My Pending Approvals', ja: '私の保留中の承認' },
  'approvals.pending.subtitle': { en: 'Forms you submitted awaiting approval', ja: '承認待ちの提出済みフォーム' },
  'approvals.pending.empty': { en: 'No pending forms', ja: '保留中のフォームはありません' },
  'approvals.status.pending': { en: 'Pending', ja: '保留中' },
  'approvals.status.approved': { en: 'Approved', ja: '承認済み' },
  'approvals.status.rejected': { en: 'Rejected', ja: '却下' },

  // Approved Requests
  'approvals.approved.title': { en: 'Approved Requests', ja: '承認済み申請' },
  'approvals.approved.subtitle': { en: 'Requests you submitted or approved', ja: '提出または承認した申請' },
  'approvals.approved.tab.mine': { en: 'My requests', ja: '自分の申請' },
  'approvals.approved.tab.approvedByMe': { en: 'Approved by me', ja: '承認した申請' },
  'approvals.approved.empty': { en: 'No approved forms yet', ja: '承認済みのフォームはまだありません' },
  'approvals.approved.empty.mine': { en: 'You have no approved requests you submitted', ja: '承認済みの自分の申請はありません' },
  'approvals.approved.empty.approvedByMe': { en: 'You have not approved any requests yet', ja: '承認した申請はまだありません' },

  // Home tile
  'home.approvedRequests': { en: "Approved Requests", ja: '承認済み申請' },

  // Return page
  'nav.sample': { en: 'Sample', ja: 'サンプル' },
  'nav.return': { en: 'Return / Credit', ja: '返品・クレジット' },
  'return.title': { en: 'Return / Credit Memo', ja: '返品・クレジットメモ' },
  'return.subtitle': {
    en: 'Create and track return / credit memo applications',
    ja: '返品・クレジットメモ申請の作成と確認',
  },
  'return.cta': {
    en: 'Start New Return/Credit Memo',
    ja: '返品・クレジットメモ申請を開始',
  },
  'return.back': { en: 'Back to Return', ja: '返品トップへ戻る' },
  'return.new.title': { en: 'New Return / Credit Memo', ja: '返品・クレジットメモ新規申請' },
  'return.new.subtitle': {
    en: 'Create a new return or credit memo application',
    ja: '返品またはクレジットメモの新規申請を作成します',
  },
  'return.new.empty': {
    en: 'Return application form will appear here.',
    ja: '返品申請フォームはここに表示されます。',
  },
  'return.form.step1': { en: 'Step 1 — Request info', ja: 'ステップ1 — 申請情報' },
  'return.form.step2': { en: 'Step 2 — Partner & order', ja: 'ステップ2 — 取引先・伝票' },
  'return.form.step3': { en: 'Step 3 — Review & Summary', ja: 'ステップ3 — 確認とサマリー' },
  'return.form.summary': { en: 'Summary', ja: 'サマリー' },
  'return.summary.type': { en: 'Type', ja: 'タイプ' },
  'return.summary.date': { en: 'Date requesting', ja: '申請日' },
  'return.summary.businessUnit': { en: 'Business unit', ja: 'ビジネスユニット' },
  'return.summary.requester': { en: 'Requester', ja: '申請者' },
  'return.summary.soldTo': { en: 'Sold-To (Channel Partner)', ja: '売掛先' },
  'return.summary.endUser': { en: 'End User', ja: 'エンドユーザー' },
  'return.summary.dairitenContact': { en: 'Contact name of Dairiten', ja: '代理店ご担当者' },
  'return.summary.dairitenEmail': { en: 'Contact email', ja: 'ご担当者メール' },
  'return.summary.orderNumber': { en: 'Order No.', ja: 'オーダーNo.' },
  'return.summary.invoiceDate': { en: 'Invoice date', ja: '伝票日付' },
  'return.summary.quoteRef': { en: 'Quote Ref No.', ja: '特価番号' },
  'return.summary.orderReason': { en: 'Order Reason', ja: 'オーダー理由' },
  'return.summary.justification': { en: 'Justification', ja: '理由' },
  'return.form.products': { en: 'Products', ja: '製品' },
  'return.form.addProduct': { en: '+ Add Product', ja: '+ 製品を追加' },
  'return.form.totalAmount': { en: 'Total Amount', ja: '合計金額' },
  // Customer Service asked for 返金 / 再請求 as the Japanese of the two line labels (23 Oct 2026); the
  // product rows show it over the English through `tBilingual`. The totals keep their own wording.
  'return.form.returnAmount': { en: 'Total Returns', ja: '返金' },
  'return.form.rebillAmount': { en: 'Total Re-billed', ja: '再請求' },
  'return.form.returnAmountTotal': { en: 'Total Returns', ja: '返品合計' },
  /* Why the re-billed field is read-only for this return type. */
  'return.form.rebillLocked': {
    en: 'Not applicable for this return type',
    ja: 'この返品タイプでは使用しません',
  },
  'return.form.rebillAmountTotal': { en: 'Total Re-billed', ja: '再請求合計' },
  // The app has no language switcher (I18nProvider is fixed to 'en'), so `en` carries JA / EN the
  // way the other return-form labels do. `ja` is left as pure Japanese: it is the per-language
  // source of truth and must never be overwritten with a mixed string.
  'return.form.standardPriceNotice': {
    en: '通常仕切りを表示しています。金額が正しいか必ずご確認の上、必要に応じて金額の上書き変更をお願い致します。 / The standard net price is currently displayed. Please be sure to verify that the amount is correct and overwrite it if necessary.',
    ja: '通常仕切りを表示しています。金額が正しいか必ずご確認の上、必要に応じて金額の上書き変更をお願い致します。',
  },
  'return.form.error.productIncomplete': {
    en: 'Add at least one product with quantity of 1 or more.',
    ja: '製品を1件以上追加し、数量は1以上にしてください。',
  },
  'return.form.error.productAmounts': {
    en: 'Return and re-billed amounts must be zero or greater.',
    ja: '返品合計・再請求合計は0以上にしてください。',
  },
  'return.form.error.productUnavailable': {
    en: 'この製品は製品マスターから削除されました。製品を選び直してください。 / This product is no longer in the product master. Choose the product again.',
    ja: 'この製品は製品マスターから削除されました。製品を選び直してください。',
  },
  'return.form.error.productRequired': {
    en: 'At least one product is required.',
    ja: '製品は1件以上必須です。',
  },
  'return.form.error.hierarchyRequired': {
    en: 'Approval hierarchy is required. Select a requester with a return mapping.',
    ja: '承認階層が必要です。返品マッピングがある申請者を選択してください。',
  },
  'return.summary.products': { en: 'Products', ja: '製品' },
  /* Confirmation page after a return is submitted. Wording mirrors the sample flow's success page
     so the two read the same; the labels themselves are reused from return.summary.* above. */
  'return.form.quantity': { en: 'Qty', ja: '数量' },
  'return.summary.grandTotal': { en: 'Grand Total', ja: '総計' },
  'return.success.title': {
    en: 'Return Request Submitted Successfully!',
    ja: '返品申請を送信しました',
  },
  'return.success.subtitle': {
    en: 'Your request has been processed and sent for approval.',
    ja: '申請を受け付け、承認者に送信しました。',
  },
  'return.success.reference': { en: 'Your Reference Number', ja: '参照番号' },
  'return.success.referenceHint': {
    en: 'Please save this number for tracking your request',
    ja: '申請の追跡にご利用ください',
  },
  'return.success.requestSection': { en: 'Request Information', ja: '申請情報' },
  'return.success.returnSection': { en: 'Return Details', ja: '返品内容' },
  'return.form.returnType': { en: 'Select return type', ja: '返品タイプを選択' },
  'return.form.returnTypePlaceholder': { en: 'Select return type...', ja: '返品タイプを選択...' },
  'return.form.requestDate': { en: 'Date requesting', ja: '申請日' },
  'return.form.businessUnit': { en: 'Business unit', ja: 'ビジネスユニット' },
  'return.form.businessUnitPlaceholder': { en: 'Select business unit...', ja: 'ビジネスユニットを選択...' },
  'return.form.requesterGroup': { en: 'Select requester group', ja: '申請者グループを選択' },
  'return.form.requesterGroupPlaceholder': { en: 'Select requester group...', ja: '申請者グループを選択...' },
  'return.form.requester': { en: 'Requester', ja: '申請者' },
  'return.form.requesterPlaceholder': { en: 'Select requester...', ja: '申請者を選択...' },
  'return.form.salesRepCode': { en: 'Sales rep code', ja: 'セールスレップコード' },
  // Corlett Siobhan, 25 Sep 2026: named so nobody mistakes what the field is for.
  'return.form.serviceRequest': { en: 'Service - TS有償作業WOと保守', ja: 'サービス - TS有償作業WOと保守' },
  'return.form.serviceYes': { en: 'Yes', ja: 'はい' },
  'return.form.serviceNo': { en: 'No', ja: 'いいえ' },
  'return.form.hierarchy': { en: 'Approval Hierarchy', ja: '承認階層' },
  'return.form.hierarchyEmpty': {
    en: 'Select a requester to load the approval hierarchy.',
    ja: '申請者を選択すると承認階層が表示されます。',
  },
  'return.form.hierarchyMissing': {
    en: 'No return approval mapping found for this requester and business unit.',
    ja: 'この申請者・ビジネスユニットの返品承認マッピングが見つかりません。',
  },
  'return.form.soldTo': { en: 'Select SOLD-TO (Channel Partner)', ja: '売掛先（チャネルパートナー）を選択' },
  'return.form.soldToPlaceholder': { en: 'Search Sold-To...', ja: '売掛先を検索...' },
  'return.form.endUser': { en: 'Select End User (optional)', ja: 'エンドユーザーを選択（任意）' },
  'return.form.endUserPlaceholder': { en: 'Search End User...', ja: 'エンドユーザーを検索...' },
  'return.form.dairitenContact': {
    en: '代理店のご担当者様名 / Contact name of Dairiten',
    ja: '代理店のご担当者様名 / Contact name of Dairiten',
  },
  'return.form.dairitenContactPlaceholder': { en: 'Contact name', ja: 'ご担当者様名' },
  'return.form.dairitenEmail': {
    en: 'ご担当者様のメールアドレス / Email address of the contact person above',
    ja: 'ご担当者様のメールアドレス / Email address of the contact person above',
  },
  'return.form.dairitenEmailPlaceholder': { en: 'name@example.com', ja: 'name@example.com' },
  /* The optional label for the same field. `return.form.dairitenEmail` above is the original,
     required-era wording and is left as it is rather than edited. */
  'return.form.dairitenEmailOptional': {
    en: 'ご担当者様のメールアドレス (任意) / Email address of the contact person above (optional)',
    ja: 'ご担当者様のメールアドレス（任意） / Email address of the contact person above (optional)',
  },
  'return.form.orderNumber': {
    en: 'オーダーNo. / The original sales order number',
    ja: 'オーダーNo. / The original sales order number',
  },
  'return.form.invoiceDate': {
    en: '伝票日付 / The Invoice date of the original sales order',
    ja: '伝票日付 / The Invoice date of the original sales order',
  },
  // Title Case, like every other mailbox name on the Return landing.
  'return.review.title': { en: 'Service Review', ja: 'サービス確認' },
  'return.review.cancel': { en: 'Cancel', ja: 'キャンセル' },
  /*
   * Vidhi on the old English label: 「正すように要求するっていう意味じゃないんですけど」 — "Correct
   * request" reads as *asking someone else* to correct it, when the button is the reviewer editing
   * it themselves. The Japanese already said that.
   */
  'return.review.correct': { en: 'Edit entries', ja: '内容を修正' },
  // A reviewer is not an approver: they pass a request on to the approvers, or discard it. The
  // underlying action is the same as approve/reject — only the words change, because the act is a
  // different one. "Discard" was chosen over "Reject" for exactly that reason.
  'return.review.sendForApproval': { en: 'Send for approval', ja: '承認へ送る' },
  /*
   * Both Vidhi and Corlett had to ask what this did, and both guessed "sends it back to the requester
   * to fix" — which is what it achieves: the request is rejected, and the requester can copy it to a
   * new draft or have it reopened. Say that instead of "Discard".
   */
  'return.review.discard': { en: 'Send back to requester', ja: '申請者に差し戻す' },
  // The correction screen: the requester's own summary, in purple, with a pencil per tile.
  'return.review.correcting': { en: 'Correcting this request', ja: 'この申請を修正中' },
  'return.review.was': { en: 'was:', ja: '変更前:' },
  'return.review.addProduct': { en: 'Add product', ja: '製品を追加' },
  'return.review.removeProduct': { en: 'Remove this product', ja: 'この製品を削除' },
  'return.review.backToQueue': { en: 'Back to review queue', ja: '確認一覧へ戻る' },
  'return.review.hasChanges': { en: 'You have unsaved corrections.', ja: '未保存の修正があります。' },
  'return.review.leaveConfirm': {
    en: 'Leave without saving? The corrections you have made on this screen will be lost.',
    ja: '保存せずに戻りますか？この画面で行った修正は失われます。',
  },
  'return.pending.subtitleWithReviewed': {
    en: 'Return / credit memo forms you submitted, and every Service case not yet approved, at any stage',
    ja: '提出した返品／クレジットメモ申請と、承認前のすべてのサービス案件（全段階）',
  },
  'return.review.undo': { en: 'Undo', ja: '元に戻す' },
  'return.review.discardEdits': { en: 'Discard edits', ja: '修正を取り消す' },
  'return.review.discardAllConfirm': {
    en: 'Discard every correction made during review and return this request to what the requester submitted? The trail will show that corrections were made and then withdrawn.',
    ja: '確認中に行ったすべての修正を取り消し、申請者が提出した内容に戻しますか？修正と取り消しの履歴は残ります。',
  },
  'return.review.requesterGroup': { en: 'Requester group', ja: '申請者グループ' },
  /*
   * The review step as a requester sees it in the route preview. The stored role stays 'Reviewer'
   * (the queues are routed on that string); this is display only, and the label alone says that
   * this person may change the request - Corlett corrects entries before the approvers see them.
   */
  'return.form.reviewerRole': { en: 'Reviewer / Corrector', ja: '確認・修正担当' },
  'return.review.fixBeforeSave': {
    en: 'Fix the highlighted fields before saving. The same rules apply as when the request was first filled in.',
    ja: '保存する前に強調表示された項目を修正してください。最初の入力時と同じルールが適用されます。',
  },
  'return.review.moreDates': { en: 'more invoice date(s)', ja: '件の伝票日付を追加' },
  'return.review.required': { en: 'Required.', ja: '必須項目です。' },
  /* Shown under the two fields a requester may leave for the review team to complete. */
  'return.review.mustCompleteBeforeApproval': {
    en: 'Fill the highlighted fields before sending this request for approval.',
    ja: '承認へ送る前に、強調表示された項目を記入してください。',
  },
  'return.review.blockedFields': { en: 'Still empty', ja: '未記入' },
  'return.review.productsSummary': { en: 'line(s)', ja: '行' },
  'return.review.viewPreviousLines': { en: 'View the lines as submitted', ja: '提出時の製品行を表示' },
  'approvals.inbox.priorComments': { en: 'Comments from earlier steps', ja: '前段階のコメント' },
  'return.review.noChanges': { en: 'Nothing changed yet.', ja: 'まだ変更はありません。' },
  'return.review.notReviewer': {
    en: 'Only the service review team can correct a request during review.',
    ja: 'サービス確認チームのみが確認中の申請を修正できます。',
  },
  'return.review.save': { en: 'Save corrections', ja: '修正を保存' },
  'return.review.sendBackReason': {
    en: 'Why is this request being sent back to the requester? They will see this.',
    ja: '申請者に差し戻す理由を入力してください。申請者に表示されます。',
  },
  'return.review.sendBackReasonRequired': {
    en: 'A reason is required to send a request back.',
    ja: '差し戻すには理由が必要です。',
  },
  'return.review.sending': { en: 'Sending…', ja: '送信中…' },
  'return.review.saveFirstHint': {
    en: 'Unsaved corrections are saved before the request is sent on.',
    ja: '未保存の修正は、承認へ送る前に保存されます。',
  },
  'return.review.saving': { en: 'Saving…', ja: '保存中…' },
  'return.review.saved': {
    en: 'Corrections saved. The approvers will see them, and the change is recorded on the request.',
    ja: '修正を保存しました。承認者に表示され、変更履歴が申請に記録されます。',
  },
  'return.review.editIntro': {
    en: 'Correct this request before the approvers see it. Every change is recorded on the request.',
    ja: '承認者に回る前に内容を修正できます。変更はすべて申請に記録されます。',
  },
  'return.review.trailNote': {
    en: 'Saved changes appear on the request as "Corrected during service review", showing what moved and who moved it.',
    ja: '保存した変更は「サービス確認中に修正」として、変更内容と実施者とともに申請に表示されます。',
  },
  'return.review.subtitle': {
    en: 'Return requests waiting for P&OP to check before the approvers see them.',
    ja: '承認者に回る前にP&OPで内容を確認する返品申請です。',
  },
  'return.review.emptyTitle': { en: 'Nothing to review', ja: '確認待ちなし' },
  'return.review.empty': {
    en: 'Nothing is waiting for review.',
    ja: '確認待ちの申請はありません。',
  },
  'return.form.standingOrder': {
    en: '定期予約 / Standing order (optional) — tick to add more invoice dates',
    ja: '定期予約 / Standing order（任意） — 伝票日付を追加する場合はチェック',
  },
  'return.form.addInvoiceDate': { en: 'Invoice date', ja: '伝票日付を追加' },
  'return.form.removeInvoiceDate': { en: 'Remove this invoice date', ja: 'この伝票日付を削除' },
  'return.form.quoteRef': {
    en: '特価番号 (任意) / Quote Ref No. (optional)',
    ja: '特価番号（任意） / Quote Ref No. (optional)',
  },
  'return.form.quoteRefPlaceholder': { en: 'Optional', ja: '任意' },
  'return.form.orderReason': { en: 'Order Reason', ja: 'オーダー理由' },
  'return.form.orderReasonPlaceholder': { en: 'Select order reason...', ja: 'オーダー理由を選択...' },
  'return.form.justification': {
    en: '返品/伝票処理が必要な理由を入力してください。（必須）',
    ja: '返品/伝票処理が必要な理由を入力してください。（必須）',
  },
  'return.form.justificationHint': {
    en: 'Service関係で一部赤黒処理等の場合は、金額等内容詳細を記載ください。 Justification — e.g. CSR Error Incorrect Pricing Applied due to no QQ quote number in the original sales order.',
    ja: 'Service関係で一部赤黒処理等の場合は、金額等内容詳細を記載ください。',
  },
  'return.form.justificationPlaceholder': {
    en: 'Enter justification for Return / Credit memo request',
    ja: '返品・クレジットメモ申請の理由を入力',
  },
  'return.form.next': { en: 'Next', ja: '次へ' },
  'return.form.back': { en: 'Back', ja: '戻る' },
  'return.form.validate': { en: 'Validate & save draft', ja: '検証して下書き保存' },
  'return.form.reset': { en: 'Reset form', ja: 'フォームをリセット' },
  'return.form.validated': {
    en: 'Return draft validated and saved locally. Backend submit is not available yet.',
    ja: '返品下書きを検証し、ローカルに保存しました。サーバー送信はまだ未対応です。',
  },
  /*
   * Step 3 submits for real now. `return.form.validate` and `return.form.validated` above are the
   * strings from before that existed and are no longer rendered anywhere; they are left in place
   * rather than edited because this flow was rolled back once for changing reviewed Japanese, and
   * a removal is easier to sign off separately than to unpick from a release.
   */
  'return.form.submit': { en: 'Submit request', ja: '申請を提出' },
  'return.form.submitting': { en: 'Submitting your request', ja: '申請を送信しています' },
  'return.form.submittingHint': {
    en: 'Generating reference number...',
    ja: '参照番号を生成しています...',
  },
  'return.form.submittingWait': {
    en: 'Please wait, this will only take a moment',
    ja: 'そのままお待ちください。まもなく完了します。',
  },
  'return.form.copyOpenFailed': {
    en: 'Could not open the copied request. Try again, or start a new return request.',
    ja: 'コピーした申請を開けませんでした。もう一度お試しか、新規の返品申請を作成してください。',
  },
  'return.form.submitError': {
    en: 'Failed to submit the return request. Please try again; if it keeps failing, contact IT.',
    ja: '返品申請の送信に失敗しました。もう一度お試しください。解決しない場合はITにご連絡ください。',
  },
  'return.form.loadingGroups': { en: 'Loading requester groups...', ja: '申請者グループを読み込み中...' },
  'return.form.loadingReps': { en: 'Loading sales reps...', ja: 'セールスレップを読み込み中...' },
  'return.form.selectBuFirst': { en: 'Select Business Unit first', ja: '先にビジネスユニットを選択' },
  'return.form.selectGroupFirst': { en: 'Select Requester Group first', ja: '先に申請者グループを選択' },
  'return.form.error.loadGroups': {
    en: 'Failed to load requester groups. Please try again.',
    ja: '申請者グループの読み込みに失敗しました。',
  },
  'return.form.error.loadReps': {
    en: 'Failed to load sales reps. Please try again.',
    ja: 'セールスレップの読み込みに失敗しました。',
  },
  'return.form.error.email': { en: 'Enter a valid email address.', ja: '有効なメールアドレスを入力してください。' },
  'return.form.error.emailRequired': {
    en: 'Email address is required.',
    ja: 'メールアドレスは必須です。',
  },
  'return.form.error.nameRequired': {
    en: 'Contact name is required.',
    ja: 'ご担当者様名は必須です。',
  },
  'return.form.error.nameInvalid': {
    en: 'Enter a valid name (letters only; no numbers).',
    ja: '有効な氏名を入力してください（文字のみ、数字不可）。',
  },
  'return.form.error.orderRequired': {
    en: 'Order number is required.',
    ja: 'オーダーNo.は必須です。',
  },
  'return.form.error.invoiceDateFuture': {
    en: 'The invoice date cannot be in the future.',
    ja: '伝票日付に未来の日付は指定できません。',
  },
  'return.form.error.invoiceDateRequired': {
    en: 'Invoice date is required.',
    ja: '伝票日付は必須です。',
  },
  'return.form.error.orderPrefix': {
    en: 'Order number must start with 1.',
    ja: 'オーダーNo.は1で始まる必要があります。',
  },
  'return.form.error.orderLength': {
    en: 'Order number must be a 10-digit number.',
    ja: 'オーダーNo.は10桁の数字である必要があります。',
  },
  'return.form.error.orderDigits': {
    en: 'Order number must be numeric.',
    ja: 'オーダーNo.は数字のみです。',
  },

  'return.inbox.title': { en: "Return Approver's Inbox", ja: '返品 承認受信箱' },
  'return.inbox.subtitle': {
    en: 'Return / credit memo forms pending your approval',
    ja: '承認待ちの返品・クレジットメモ申請',
  },
  'return.inbox.empty': {
    en: 'No return approvals in your inbox.',
    ja: '返品の承認待ちはありません。',
  },
  'return.pending.title': { en: 'Return Pending Approvals', ja: '返品 保留中の承認' },
  'return.pending.subtitle': {
    en: 'Return / credit memo forms you submitted awaiting approval',
    ja: '承認待ちの提出済み返品・クレジットメモ申請',
  },
  'return.pending.empty': {
    en: 'No pending return applications.',
    ja: '保留中の返品申請はありません。',
  },
  'return.approved.title': { en: 'Return Approved Requests', ja: '返品 承認済み申請' },
  'return.approved.subtitle': {
    en: 'Approved return / credit memo requests',
    ja: '承認済みの返品・クレジットメモ申請',
  },
  'return.approved.empty': {
    en: 'No approved return applications yet.',
    ja: '承認済みの返品申請はまだありません。',
  },

  // Wizard
  'wizard.title': { en: 'New Application', ja: '新規申請' },
  'wizard.step1': { en: 'Step 1 — Type', ja: 'ステップ1 — 種別' },
  'wizard.step2': { en: 'Step 2 — Products', ja: 'ステップ2 — 製品' },
  'wizard.step3': { en: 'Step 3 — Review & Submit', ja: 'ステップ3 — 確認と提出' },

  /**
   * Bilingual field hints: always show Japanese first, English second (`tBilingual` / BilingualFieldCaption).
   * `ja` / `en` slots are fixed lines, not UI-language switching.
   */
  'wizard.bilingual.attention': {
    ja: 'ご担当者部署及びご氏名（任意）',
    en: 'Attention to — department and contact name for sample shipment (optional)',
  },
  'wizard.bilingual.freeSample': {
    ja: '販促／不良交換／装置設置のため、など必ず理由を入力してください。（必須）',
    en: 'Free sample justification — e.g. sales promotion, defective exchange, equipment installation. Required.',
  },
  'wizard.bilingual.specificDate': {
    ja: '希望着日を記入（日付指定）',
    en: 'Specific date — enter requested arrival date.',
  },

  // Common
  'common.next': { en: 'Next', ja: '次へ' },
  'common.back': { en: 'Back', ja: '戻る' },
  'common.loading': { en: 'Loading...', ja: '読み込み中...' },
  'common.error': { en: 'Error', ja: 'エラー' },
}

interface Ctx {
  t: (k: keyof typeof dict) => string
  /** Japanese primary + English subline (fixed `dict[k].ja` / `dict[k].en`), regardless of UI language. */
  tBilingual: (k: keyof typeof dict) => { jp: string; en: string }
  lang: Lang
  setLang: (l: Lang) => void
}

const Ctx = createContext<Ctx | null>(null)

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>('en')
  const value = useMemo<Ctx>(() => ({
    t: (k) => dict[k]?.[lang] ?? String(k),
    tBilingual: (k) => ({
      jp: dict[k]?.ja ?? String(k),
      en: dict[k]?.en ?? String(k),
    }),
    lang,
    setLang,
  }), [lang])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useI18n() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}
