import { formatProductCodes, type ProductCodeSource, type ProductCodeUnit } from '../utils/productCodes'

/**
 * A product's codes, on one line, directly under its name: "Code: 12005 · SAP: 00100B".
 *
 * Shashank Srivastava, 30 Sep 2026: "In case of CDG product, local product code and SAP code should
 * always appear side by side (for both Return and Forward)", and in the sample wizard the code sat
 * "too far" - a column of its own beside the picker, the SAP number stacked over the local one, and
 * on the return side a cell so narrow it broke 00100B in two. One component, so every screen reads
 * the same, and the line does not wrap, so the two codes never part. The mails print the same line.
 *
 * LSG has no SAP number and shows the local code alone; a CDG product whose SAP number was never
 * imported shows "SAP: —" (see productCodeParts).
 */
export default function ProductCodeLine({
  product,
  unit,
  className = 'text-xs text-gray-500',
}: {
  product: ProductCodeSource | null | undefined
  unit: ProductCodeUnit
  className?: string
}) {
  const text = formatProductCodes(product, '—', unit)
  return (
    <div className={`${className} whitespace-nowrap`} title={text}>
      {text}
    </div>
  )
}
