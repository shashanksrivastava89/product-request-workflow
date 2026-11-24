/**
 * The service review screen — the return wizard, in review mode.
 *
 * This used to be a screen of its own: the requester's summary with every tile opened into an
 * editor, and its own copy of each field's control. Shashank, 10 Sep: *"centralize this with the
 * request journey … in future if requester journey adds a field, reviewer should receive it as
 * well"*. So the reviewer now walks the same three steps the requester did, with the same fields
 * from the same JSX, and everything that is true only of a review — the request as loaded, "was: …"
 * with an Undo, the route preview, the two gates, save / send / send back — comes from
 * useReturnReview and is layered onto the wizard by its `review` mode.
 *
 * The route (`/return/edit/:id`) and the server rules are unchanged: the server still decides who
 * may correct a request and when (`reviewWindowDenial`), records every saved change on the trail,
 * and refuses to pass a request on while a required field is empty.
 */
import ReturnWizard from '../components/ReturnWizard'

export default function ReturnReviewEdit() {
  return <ReturnWizard mode="review" />
}
