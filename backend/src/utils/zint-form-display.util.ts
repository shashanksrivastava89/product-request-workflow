export const ZINT_SOLD_TO_CODE = '5002909';
export const ZINT_SOLD_TO_NAME = 'ACME QUALITY ASSUARANCE';
export const ZINT_END_USER_MESSAGE = 'No end-user exist for internal orders.';

export function isZintForm(formType?: string | null): boolean {
  return String(formType ?? '').toUpperCase() === 'ZINT';
}

export type ZintDeliveryDisplayFields = {
  formType?: string | null;
  soldToCode?: string | null;
  soldToName?: string | null;
  endUserCode?: string | null;
  endUserName?: string | null;
};

/** ZINT QC uses fixed sold-to and a display-only end-user message in emails/UI. */
export function applyZintDeliveryDisplayFields<T extends ZintDeliveryDisplayFields>(data: T): T {
  if (!isZintForm(data.formType)) return data;
  return {
    ...data,
    soldToCode: data.soldToCode || ZINT_SOLD_TO_CODE,
    soldToName: data.soldToName || ZINT_SOLD_TO_NAME,
    endUserCode: undefined,
    endUserName: ZINT_END_USER_MESSAGE,
  };
}
