# HubSpot renewal order rebuild

Four HubSpot custom code actions that take a Subskribe subscription, find the
renewal order already quoted against it, and rebuild that order off a fresh
`draftRenewal` so it picks up the current catalog while keeping the negotiated
commercial terms.

| Step | File | Does |
| --- | --- | --- |
| 1 | `step1-find-existing-renewal-order.js` | Finds the renewal order in HubSpot, loads it from Subskribe, checks it is still a draft |
| 2 | `step2-rebuild-renewal-order.js` | Rebuilds and creates the new order — all the logic lives here |
| 3 | `step3-set-primary-order.js` | Marks the new order primary for the opportunity |
| 4 | `step4-force-hubspot-sync.js` | Forces the Subskribe → HubSpot order sync |

Each file is pasted whole into its HubSpot action. `SubskribeAPIKey` and
`API_KEY` come from the action's secrets.

## Business units

One set of scripts serves every unit. The workflow picks one with a
`business_unit` input field; omitting it defaults to `EP`, so an existing
workflow keeps working untouched.

| Unit | Entity | Notes |
| --- | --- | --- |
| `EP` | `ENT-MNJ0N5D` | Education Perfect. Rate-card priced, multi-year ramps common |
| `EA` | `ENT-H5MFM0T` | Essential Assessment. No price attributes, single period |

The `BUSINESS_UNITS` map at the top of each file holds everything that is
genuinely unit-specific — the entity id, the HubSpot Orders object type
(step 1), and the name and label of the per-line custom field the unit treats
as required. Everything else (plans, charges, attributes, prices, discounts,
ramp structure) is discovered at runtime from the order and the subscription,
so adding a unit means adding an entry, not writing code.

Essential Assessment exercises paths EP never reaches, which is why it has its
own fixture:

- **No `attributeReferences` at all.** EA is not rate-card priced — the sector
  lives in the choice of plan ("EA Products (2026) Independent" vs
  "… Government + Religious"), not in a price attribute. Every
  `buildAttributeKey()` comes back empty, so the attribute-based matching
  tiers can no longer discriminate and only the subscription charge link,
  `chargeId` and quantity carry the match. That is fine on three-charge orders;
  it would be weaker on large ones.
- **Non-numeric Year Groups.** `P/F/K; 1; 2; 3; 4; 5; 6` is what caught the
  years normaliser rewriting the quote's own wording. Normalisation is for
  comparison only; the value is written back exactly as the source had it.
- Single period, `RENEWAL` rather than `ADD` actions, and a `taxEstimate` field
  EP orders do not carry.

### EA renews onto a deprecated plan, and the rebuild cannot fix that

No `replacementPlanIds` are configured on any EA plan. So `draftRenewal` for
SUB-N0JCC5Q proposes **PLAN-T7N6194** — the deprecated 2025 plan — carrying the
subscription forward at its own negotiated price rather than re-versioning onto
the 2026 plans. The rebuild reproduces the quote on whatever plan the draft
proposes; it does not migrate plans, and it has no way to know that
PLAN-46REVQW and PLAN-YYEMQ4K supersede PLAN-T7N6194.

Contrast EP, where replacement plans *are* configured: its swapped lines carry
`replacedPlanId: "PLAN-CMJB619"`, which is what drives the cross-charge
matching passes.

The catch for EA is that the 2026 catalog splits by sector into two plans
(Independent and Government + Religious). Subskribe's plan replacement is
per-plan, not per-account, so a single `replacementPlanIds` on PLAN-T7N6194
cannot serve both — which is probably why it is unset. Migrating plans in the
rebuild instead would need a sector signal available at runtime (nothing on
the order, subscription or account carries one) plus an explicit old-charge to
new-charge mapping, and it would change this tool's job from *reproduce the
quote* to *migrate the quote*.

## What step 2 has to reconcile

`draftRenewal` returns a clean single-period order priced at catalog, with the
tier attributes it defaults to and no Year Groups. The existing order carries
the negotiated position: agreed prices, discounts and list price overrides,
the Year Groups actually sold, and — on a multi-year deal — a different price
and cohort for every year. The subscription sits in between and is the
authority on which charges renew at all.

The rebuild walks the fresh draft line by line, resolves each line back to a
subscription charge, matches it to the line on the existing order that
represents the same commercial item, and takes price and Year Groups from
there. Plan re-versions make that harder than it sounds: the charge underneath
a line gets renamed, so the same item appears under one `chargeId` in the
existing order and another in the draft. Matching therefore runs in passes —
subscription charge UUID, then catalog charge id, then an exact attribute
match, then a whole cohort of interchangeable lines paired positionally —
so a stronger signal always claims a line before a weaker one can.

## Multi-year and ramped orders

A multi-year order quotes each charge once per year, each with its own price,
quantity and Year Groups, under an order-level `termLength` and a
`rampInterval` spanning the periods. A fresh draft only ever proposes one
period, so the rebuild cannot copy it straight across.

The existing order is the authority on that structure:

1. **Periods** come from its `rampInterval` (or, if absent, the date windows
   on its own ramp lines). Every period boundary is shifted by the difference
   between the draft's start and the existing order's start, so a renewal
   beginning a little earlier or later still gets periods of the negotiated
   length. A gap of more than 45 days means the existing order was quoted for
   a different term entirely, and the rebuild refuses.
2. **Existing lines are pooled by period.** A draft line is matched once per
   period against only the lines covering that period, so each replica is
   priced from its own year rather than from whichever year the matcher
   reached first.
3. **A line is replicated per period only if the existing order ramped it.**
   Zero-quantity catalog lines that span the whole term stay single full-span
   lines, which is how the existing order carries them. A brand new billable
   line with no counterpart anywhere is ramped and carried forward by the
   period-over-period uplift read off the rest of the order, so it does not
   sit flat while everything around it rises.
4. **The order is posted with the term it was quoted for** — `startDate`,
   `endDate`, `termLength` and `rampInterval` — along with the existing
   order's billing cycle and billing term, which a one-year draft knows
   nothing about.

The subscription charge link (`subscriptionChargeId`) is echoed back on the
first period only: one subscription charge continues into one renewal line,
and the later periods are ramp continuations of that line.

A plain one-year order collapses to exactly one period and takes the same code
path it always did — the payload it produces is unchanged.

## Guard rails

Step 2 refuses to create an order rather than create a wrong one:

- the order renews a **different subscription** than the one the run was given.
  Executing a renewal creates the next subscription and the workflow is
  re-enrolled against that one, while the HubSpot order record can still point
  at the order that was executed. `draftRenewal` then offers the term *after*
  the one the order quotes, so rebuilding would price a future term off a
  signed quote. Checked before the `draftRenewal` call, so it costs nothing.
  Step 1 folds the same check into `eligible_for_rebuild`

- no line items built, or a count that does not match one line per draft item
  per period
- a billable line on the existing order whose window falls outside every ramp
  period, which would silently drop its value
- a billable line with no Year Groups
- rebuilt quantity below the quantity **the existing order quotes for that
  period** — summing the whole order would let a dropped line in one year hide
  behind the duplicate quantity of another
- more than 6 ramp periods, or a fresh draft that is itself already ramped
- a renewal term more than 45 days away from the one the existing order was
  quoted for

## The quote is the spec, not the subscription

Everything above rests on one rule: **the rebuild reproduces the order being
rebuilt.** The subscription says what *could* renew; the order says what was
actually sold, and the two differ all the time.

That cuts both ways, and both directions have bitten:

- **Fewer seats on a line.** ORD-39HY7JN quotes 744 seats against a
  subscription whose final period carries 809, because the Y11/12 lines were
  consolidated from three charges into two. So the quantity check measures
  each period against what the existing order quotes for that period, never
  against the subscription — otherwise every renewal quoted down is refused.
- **Fewer lines.** ORD-WD9TZMR is a 790-seat quote against a subscription that
  took a mid-term amendment adding a block of "Plus" upgrade charges the deal
  does not carry forward. Those charges are live right up to the subscription's
  end, so the draft keeps offering them — ten billable lines and 1,685 seats.
  A billable draft line that matches nothing anywhere in the existing order is
  therefore **held at quantity zero** and named in the log. Building it at its
  draft quantity would not reproduce the quote, it would write a new one at
  roughly double the value.

Zeroed, not removed: **a plan is all or nothing.** Drop some of a plan's
charges and the API rejects the whole order —

```
400 charges CHRG-FJ0TYZK, CHRG-DZCPWQC from plan id PLAN-TG9K5EY are missing in order
```

A quantity of zero adds no value, keeps every plan complete, and is exactly
how the existing order already carries the catalog lines nobody bought
(ORD-WD9TZMR has fifteen of them).

Warnings that do not fail the workflow: the rebuilt total drifting more than
10% from the existing order, a created term shorter than what was built, any
line the API repriced, a billable subscription charge with no line in the
rebuild, charges zeroed because the quote does not carry them, and a period
carrying fewer seats than the subscription's renewing charges.

Logs are kept under HubSpot's 4KB ceiling, which counts a ~30-byte timestamp
and level prefix on every line as well as the message. Per-line output is
capped at 12 billable lines, periods and pools are summarised on one line each
rather than one per period, and every charge list is truncated with a `+N`
count. The two real orders in the fixtures come in around 2.9KB and 2.4KB with
prefixes included; `node test/rebuild-renewal-order.test.js` does not check
this, so re-measure if you add logging.

## Tests

```
node test/rebuild-renewal-order.test.js
```

Runs the real step 2 file with `axios` stubbed, against fixtures modelled on
ORD-39HY7JN (a two-year ramped order) and a one-year variant of the same deal.
No network, no dependencies.
