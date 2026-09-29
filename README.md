# SPHERO website

Marketing site for SPHERO, an AI career-readiness system, built from *SPHERO Website PRD + Experience Design Specification v1.0*.

- Live site (built with Higgsfield website tools): https://sphero-readiness.higgsfield.app
- Stack: React 19, TanStack Start (SSR), Cloudflare Worker, D1 for the account-step waitlist.
- Source of truth for the site code is the Higgsfield website project `sphero-readiness`. This repo records the build.

## What was built (from the PRD)

- Home: scroll-scrubbed hero film (orbiting sphere of capability nodes) with the Target, Diagnose, Plan, Practice, Prove rail; problem statement; interactive operating loop; sample candidate journey; one model of you; practice matcher; capability constellation; trust; pricing teaser and final CTA.
- Product, How it works, Gap Intelligence (interactive gap report), Diagnostic Interview, Learn, Practice Lab, Mock Interviews, Projects, Readiness.
- Roles hub and Data Science role page, Pricing, Resources, Manifesto, Security and privacy, Find my gaps flow (target, resume, preview, account handoff), Sign in.
- Design tokens from the PRD: Night #050A12, Deep Space #0A1220, Electric Azure #38BDF8, Cobalt #2563EB, Indigo #6157F5, Cloud #F6F8FB; Inter Tight + Inter.
- Analytics event taxonomy from the PRD (hero_cta_clicked, gap_flow_started, gap_preview_viewed, account_created, example_opened, practice_demo_started, pricing_viewed, plan_selected, resource_cta_clicked, login_clicked) dispatched to `window.dataLayer`, with no resume, JD, transcript or personal data in properties.

## Open items from the PRD

- P0 brand gate: "Sphero" is used by Sphero, Inc. Trademark, company-name, domain and app-store clearance is still required before public launch.
- Pricing, legal entity name and customer proof are intentionally TBD. The site shows no fabricated logos, testimonials or outcome statistics.
