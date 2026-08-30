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
`API_KEY` come from the action's secrets; the entity id is hard-coded.

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

- no line items built, or a count that does not match one line per draft item
  per period
- a billable line on the existing order whose window falls outside every ramp
  period, which would silently drop its value
- a billable line with no Year Groups
- rebuilt quantity below the expected renewal quantity **in any single
  period** — summing the whole order would let a dropped line in one year hide
  behind the duplicate quantity of another
- more than 6 ramp periods, or a fresh draft that is itself already ramped
- a renewal term more than 45 days away from the one the existing order was
  quoted for

After creation it warns (without failing the workflow) when the rebuilt total
drifts more than 10% from the existing order, when the created term is shorter
than what was built, and on any line the API repriced.

## Tests

```
node test/rebuild-renewal-order.test.js
```

Runs the real step 2 file with `axios` stubbed, against fixtures modelled on
ORD-39HY7JN (a two-year ramped order) and a one-year variant of the same deal.
No network, no dependencies.
