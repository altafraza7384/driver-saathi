# Admin-Managed Subscription Plan Catalog

## What will be added
- A Subscription Plans section in Settings that lets drivers view active plan details, with no plan selection, enrollment, or payment action.
- An Admin Panel page for creating, editing, and activating/deactivating plans. Plan fields include name, description, INR amount, free/monthly/yearly billing interval, and feature list.
- One initial Free plan at ₹0. The catalog will clearly distinguish plan information from an active subscription; paid benefits and billing will not be activated.
- Payment gateway setup remains deferred and will not collect or store gateway credentials.

## Safety and data access
- Store the shared catalog in one application table. Authenticated drivers can read active plans; only authenticated admins, verified with the existing server-side `has_role` function, can manage all plans.
- Use explicit Data API grants and row-level security. Do not create per-user subscription records while drivers are view-only and payment is deferred.

## Implementation
- Add and apply the catalog schema through the Lovable Database migration tool, then seed the initial Free plan as a data operation.
- Add a Settings catalog view, an admin plan editor following existing admin page patterns, and an Admin Panel entry and protected route.
- Update generated database types as needed and add focused coverage for any pricing or visibility rules introduced.

## Validation
- Verify that the app builds, the Free plan renders in Settings, and plan editing controls are available only within the existing admin-protected area.
- Confirm no checkout, payment gateway, or plan-activation behavior was added.
