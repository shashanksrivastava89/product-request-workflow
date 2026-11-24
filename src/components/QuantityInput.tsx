/**
 * A quantity box that does not fight the typist.
 *
 * Both wizards bound this field as `value={quantity < 1 ? '' : quantity}` with an onChange that maps
 * an empty string to 0. So the moment the parsed value reached 0 — clearing the box to retype it, or
 * typing a leading zero — the field blanked itself under the cursor and the border flashed red.
 * Reported from UAT as the quantity "becoming stuck" after an amount had been entered.
 *
 * While the box has focus it shows exactly what was typed. The parsed number is still committed on
 * every keystroke, so totals and validation behave as they did. On blur the draft is dropped, the
 * canonical value takes over, and the snap-back both wizards already had still runs.
 *
 * `decimals` opens it up to fractional quantities: service work is booked in hours, so 1.5 and 0.35
 * are real quantities (Corlett Siobhan, 17 Sep). Left at 0 the box behaves exactly as it always has,
 * which is what the sample wizard keeps — those flows have shipped with whole quantities for months.
 * The spinner arrows go with decimals on: stepping by 0.001 is no use to anyone, and Vidhi Parsons
 * asked for them to go.
 */
import { useState } from 'react'
import {
  blockNegativeAndDecimal,
  blockNegativeOnly,
  formatQuantity,
  quantityFromDecimalInput,
  quantityFromInput,
} from '../utils/numericInput'

export default function QuantityInput({
  value,
  onChange,
  onSnapBack,
  decimals = 0,
}: {
  value: number
  onChange: (quantity: number) => void
  /** Run on blur when the committed value is still too low. Both wizards snap it to 1. */
  onSnapBack: () => void
  /** Decimal places allowed. 0 (the default) keeps the whole-number behaviour. */
  decimals?: number
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)

  const fractional = decimals > 0
  const minimum = fractional ? 0 : 1
  // Red only once the typist has moved on: a half-typed value is not yet wrong.
  const invalid = !focused && (fractional ? value <= 0 : value < minimum)
  const parse = fractional ? quantityFromDecimalInput : quantityFromInput
  const settled = fractional ? (value > 0 ? formatQuantity(value) : '') : value < 1 ? '' : String(value)

  return (
    <input
      type="number"
      min={0}
      step={fractional ? 10 ** -decimals : 1}
      className={`border rounded px-2 py-1 w-full text-sm ${fractional ? 'no-spinner ' : ''}${invalid ? 'border-red-500' : 'border-gray-300'}`}
      value={draft ?? settled}
      onKeyDown={fractional ? blockNegativeOnly : blockNegativeAndDecimal}
      onFocus={() => {
        setFocused(true)
        setDraft(null)
      }}
      onChange={(e) => {
        setDraft(e.target.value)
        onChange(parse(e.target.value))
      }}
      onBlur={() => {
        setFocused(false)
        setDraft(null)
        if (value < minimum || value <= 0) onSnapBack()
      }}
    />
  )
}
