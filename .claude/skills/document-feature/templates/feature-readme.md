# <Feature>

<One or two sentences: what this feature does for the user/business.>

## Entry points
- `POST /orders` – `CreateOrder.cs`
- `OrderPaidHandler` – consumes `PaymentCompleted`

## Invariants
- <Rule that must never break> – covered by `<TestClass.TestName>`

## Dependencies
- Features: <Other feature> (via `<interface>`)
- External: <service / queue / table>
- Config: `<Section>` in appsettings

## Feature flags
| Flag | Default | Owner | Remove by |
|---|---|---|---|
| – | | | |

Spec: <spec-id or –> · ADRs: <NNNN, …>