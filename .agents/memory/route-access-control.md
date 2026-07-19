---
name: Route-level access control
description: How the beauty-clinic frontend gates pages by role/permission, and why redirect-not-deny.
---

# Route-level access control (beauty-clinic frontend)

The sidebar nav filter alone does NOT secure pages — it only hides links. Direct
URL navigation must be gated separately by a route guard.

**Single source of truth:** `canAccessNavItem(item, role, hasPermission)` in
`components/layout.tsx` is shared by both the sidebar `visibleItems` filter and
the `Protected` route guard in `App.tsx`. Keep new routes/permissions in sync via
this helper + `navItems` so the two never drift.

**Guard behavior — redirect, not access-denied:** `Protected` redirects an
unauthorized user to their *first allowed* nav item (`useFirstAllowedPath`),
falling back to an inline "no access" message only when they have zero allowed
pages.

**Why redirect:** `pages/login.tsx` sends every user to `/` after login, but a
`laser_operator` has only the `laser` permission (no `dashboard`). A hard
access-denied on `/` would strand them on login. Redirecting `/` → first allowed
(`/laser`) makes login land correctly without special-casing login.tsx.

**admin bypass:** `hasPermission` returns true for `admin`, so admins skip all
guards — the admin route smoke test stays green.

**This is client-side UX gating only.** Real data security must be enforced by
the api-server; the frontend guard just prevents rendering pages the user
shouldn't navigate to.
