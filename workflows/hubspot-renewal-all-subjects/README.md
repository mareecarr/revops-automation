# Renewal "All Subjects" rebuild

Two HubSpot custom code actions, run in this order in one workflow.

| Step | File | Does |
| --- | --- | --- |
| 1 | `rebuild-order-from-details.js` | Reads the rep's free text and rebuilds the deal's draft renewal order from it |
| 2 | `sync-order-to-hubspot.js` | Pushes the rebuilt order back onto the HubSpot record straight away |

The rebuild reads the rep's free text out of the deal's `order_details`, throws
away the plans on the deal's draft renewal order, and rebuilds it from the
newest ACTIVE year-band plans at the quantities, year groups, tier, sector and
price the text states. The order is left in DRAFT.

| | |
| --- | --- |
| File | `rebuild-order-from-details.js` |
| Input properties | `order_details`, `subskribe_order_id` (deal) |
| Secret | `SubskribeAPIKey` |
| Outputs | `order_updated`, `update_summary`, `update_error` |

`DRY_RUN = true` at the top of the file sends the real payload with
`?isDryRun=true`, so Subskribe validates and prices it but saves nothing.

## Flow

1. **Read the order** first, so the parser knows the currency. Sector and
   subject aliases resolve per currency — `gov` is `Gov > 930` on AUD and
   `Gov < 495` on NZD; `Hums`/`SOSE`/`Social Sciences` all resolve to whichever
   of "Humanities" (AUD) or "Social Sciences" (NZD) the charges actually carry.
2. **Parse** each line into quantity, year groups, subjects (or an All Subjects
   bundle), tier, sector and price.
3. **Build the catalogue** from ACTIVE plans named `<year> <region> <from>-<to>
   <Core|Other Subjects|All Products|All Subjects>`, keeping the newest contract
   year per band.
4. **Resolve** every line against the bands its year groups fall into.
5. **Two PUTs.** `listUnitPrice` is ignored on a `RATE_CARD_LOOKUP` charge, so
   the quoted price has to be applied as a discount off the rate card base —
   and that base is only knowable once Subskribe has priced the line. Pass 1
   posts the structure, pass 2 posts the same lines with the discount worked
   out. A price *above* the rate card is a `listPriceOverrideRatio` instead,
   because a discount can only reduce a price.

## One charge, several cohorts

A plan band is wider than a year level, so two lines that describe different
cohorts of the same subject land on the same charge of the same plan:

```
74 Y11 EP Essentials Plus Independent $115     -> English in the 11-13 plan, year 11, $23
92 Y 12-13 Eng Plus Independent $49            -> English in the 11-13 plan, years 12-13, $49
```

Each selection becomes its own order line with its own quantity, price and Year
Groups, which is how a rep builds it by hand. Three things follow from that:

- **A line is identified by plan + charge + year groups**, not plan + charge.
  Target prices and the rate card bases read back from pass 1 are keyed that
  way, or the two cohorts would price each other.
- **Only one cohort per charge can be a `RENEWAL`** — one subscription charge
  renews once, so the rest are `ADD`s. The cohort that takes `RENEWAL` is the
  one whose year groups best match what the existing order already sells.
- **A conflict is a double booking, not a repeat.** The rebuild refuses only
  when the same charge is claimed twice for the *same* year group, because then
  there is no way to know which quantity and price was meant.

## Guard rails

The action refuses to write, and reports on `update_error`, when the order is
not a DRAFT, the text has no usable lines, a line has no sector to fall back
on, a year group no band covers, a subject a band does not sell, or the same
charge is double-booked for one year group. It also refuses if the
subscription behind the renewal cannot be read, since `RENEWAL` vs `ADD` then
cannot be decided safely.

Zeroed, not removed: every charge of every plan the rebuild touches is posted,
unselected ones at quantity 0, because dropping one makes Subskribe reject the
whole order (`charges CHRG-x from plan id PLAN-y are missing in order`).
Subscription charges the rebuild drops — last year's bundle plans, typically —
are posted as `MISSING_RENEWAL` rather than left off. Charges priced any other
way than off the rate card (the one-time PER_UNIT "Decode Teacher PD" fee) go
on at quantity 0 with no price attribution at all, since Subskribe rejects the
order if the field is merely present on them.

## The sync step

Subskribe pushes orders to HubSpot on a schedule, so a freshly rebuilt order
can sit invisible on the deal for a while. `sync-order-to-hubspot.js` forces it
by POSTing to `/hubspot/sync/order/{id}` — the same call the "Sync Orders"
Google Sheet made, minus everything the sheet only needed because it was a
sheet.

| | |
| --- | --- |
| File | `sync-order-to-hubspot.js` |
| Input properties | `subskribe_order_id` (deal), `business_unit` (optional text, `EP` or `EA`) |
| Secret | `SubskribeAPIKey` |
| Outputs | `hubspot_sync_success`, `synced_order_id`, `sync_error` |

The sheet looped rows, paced itself with a delay between calls, wrote a status
back and deleted the row. A workflow action runs once per enrolled deal, so the
loop and the bookkeeping go; the Entity column becomes the `business_unit`
input; and the pacing becomes a retry, since HubSpot can enrol a batch of deals
at once and no execution knows what the others are doing. A 429, a 5xx or a
dropped connection is retried twice (2s, then 4s — the whole budget has to stay
inside HubSpot's 20-second limit on an action); a 400 or a 404 is not, because
it will say the same thing however often it is asked. Giving up is not fatal —
the scheduled sync still picks the order up — so the workflow can carry on.

## Tests

```
node test/all-subjects-rebuild.test.js       # VERBOSE=1 to see the action's own log
node test/sync-order-to-hubspot.test.js
```

The rebuild test runs the real file with `axios` stubbed against a fixture of
ORD-7V4N727 (Dilworth School, 2027 NZD renewal). The stub prices pass 1 off a
fake rate card, so the two-pass discount arithmetic is checked end to end. The
sync test covers the entity lookup, what is retried and what is not.
