import { FormData, ProductItem } from '../providers/FormContext'

type Key =
  | 'purpose'
  | 'requestDate'
  | 'businessUnit'
  | 'requesterGroup'
  | 'requesterId'
  | 'salesRepCodeSap'
  | 'approvals'
  | 'deliveryMode'
  | 'endUserCode'
  | 'endUserDetails'
  | 'shipTo'
  | 'soldTo'
  | 'deliveryDepartment'
  | 'deliveryContact'
  | 'products'
  | 'commentsForApproval'
  | 'freeDescription'

const ORDER: Key[] = [
  'purpose',
  'requestDate',
  'businessUnit',
  'requesterGroup',
  'requesterId',
  'salesRepCodeSap',
  'approvals',
  'soldTo',
  'endUserCode',
  'endUserDetails',
  'products',
  'commentsForApproval',
  'freeDescription',
  'deliveryMode',
  'shipTo',
  'deliveryDepartment',
  'deliveryContact',
]

function clearApprovals(f: FormData) {
  f.salesManager = undefined
  f.districtSalesManager = undefined
  f.nationalSalesManager = undefined
  f.localFinanceController = undefined
  f.directorCommercialManager = undefined
}

function clearEndUserDetails(f: FormData) {
  f.endUserName = undefined
  f.endUserDepartment = undefined
  f.endUserContact = undefined
  f.postalCode = undefined
  f.prefecture = undefined
  f.address = undefined
  f.phone = undefined
}

function clearShipToSoldTo(f: FormData) {
  f.shipToCode = undefined
  f.shipToName = undefined
  f.attentionTo = undefined
  f.soldToCode = undefined
  f.soldToName = undefined
}

/**
 * Reset all fields downstream from the changed key, preserving date fields.
 * This returns a new form object; callers can set the changed field before/after as needed.
 */
export function resetDownstream(form: FormData, changedKey: Key): FormData {
  const preservedRequestDate = form.requestDate


  const idx = ORDER.indexOf(changedKey)
  if (idx < 0) return form

  const next: FormData = { ...form }

  for (let i = idx + 1; i < ORDER.length; i++) {
    const k = ORDER[i]
    switch (k) {
      case 'businessUnit':
        next.businessUnit = undefined
        break
      case 'requesterGroup':
        next.requesterGroup = ''
        break
      case 'requesterId':
        next.requesterId = ''
        next.requesterName = ''
        break
      case 'salesRepCodeSap':
        next.salesRepCodeSap = ''
        break
      case 'approvals':
        clearApprovals(next)
        break
      case 'deliveryMode':
        next.deliveryMode = undefined
        break
      case 'endUserCode':
        next.endUserCode = undefined
        break
      case 'endUserDetails':
        clearEndUserDetails(next)
        break
      case 'shipTo':
        next.shipToCode = undefined
        next.shipToName = undefined
        break
      case 'soldTo':
        next.soldToCode = undefined
        next.soldToName = undefined
        break
      case 'deliveryDepartment':
        next.deliveryDepartment = undefined
        break
      case 'deliveryContact':
        next.deliveryContact = undefined
        break
      case 'products':
        next.products = []
        break
      case 'commentsForApproval':
        next.commentsForApproval = undefined
        break
      case 'freeDescription':
        next.freeDescription = undefined
        break
      case 'purpose':
      case 'requestDate':
        // these are upstream of changedKey; skip
        break
      default:
        break
    }
  }

  // Preserve date fields
  next.requestDate = preservedRequestDate

  return next
}

export function resetProductRowDownstream(p: ProductItem): ProductItem {
  return {
    ...p,
    sapCode: '',
    productName: '',
    unitPrice: 0,
    wholesalePrice: 0,
    subTotal: 0,
    lotNumber: undefined,
    note: undefined,
  }
}
