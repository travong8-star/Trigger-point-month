# CLAUDE.md — Interactive Trigger Point Map

> This file is read at the start of every Claude Code session. It is the source of truth for what we're building, how, and the rules that don't bend. Keep it updated as phases complete.

---

## What this is

A **mobile-first Progressive Web App (PWA)**: an interactive trigger point map. A user taps a region of the body, sees the muscles and trigger points in that region, and for each point sees where the pain refers to, how it's treated, the stretch, and any safety caution.

Built as a PWA on purpose: installable on any phone, works offline once loaded, **no app store** friction.

**Product model:** freemium lead magnet. A free tier (planned: Head & Neck region) feeds the paid full 100-point tool, which is sold through Stan.store (stan.store/VitalEssence_Mt). Build with a clean seam between free and paid content so gating is a config change, not a rebuild.

**Two audiences, one tool:**
- **Practitioners** (massage therapists) — building palpation confidence and clinical reasoning.
- **Chronic pain clients** — understanding what's happening in their own body.
Same data, framing can flex later. Don't hardcode assumptions that block a future "practitioner mode / client mode" toggle.

---

## The data — `trigger_points.json`

Already built and validated. **Do not regenerate it; read from it.** 100 points, 20 per region.

Top-level keys:
- `meta` — title, count, disclaimer text (use this verbatim in the UI), schema_version, field list.
- `regions` — region name → array of point IDs. **These five regions are the map's tappable zones.**
- `referral_index` — referral zone (e.g. `"outer thigh"`) → array of point IDs. **This is the reverse-lookup engine. It is the product's differentiator — treat it as a first-class feature, not a nice-to-have.**
- `points` — the array of 100 records.

Each point:
```
id            integer, 1–100
card          zero-padded string, "001"–"100"
muscle        e.g. "Gluteus medius"
trp           trigger point label, e.g. "TrP 1 - posterior"
region        one of the 5 regions
location      palpation landmark (verbatim)
referral      referral zone text (verbatim)
referral_tags normalized zone list (seeds reverse-lookup; first pass, not gospel)
protocol      standard ischemic-compression protocol
stretch       stretch / ROM reassessment
caution       boolean — education-only / extra-care points
caution_note  text when caution is true, else null
```

**Known data review items (surface these to the user, don't silently change):**
- `caution` flags fired only where the source used explicit caution language. Iliacus (071/072) is NOT flagged but is the same deep hip-flexor risk class as psoas — user's clinical call whether to match them.
- `referral_tags` are an auto-generated first pass. Verify zone accuracy before leaning on them heavily in the reverse-lookup UI.

---

## Architecture — the rule that doesn't bend

**Three separate layers. Never entangle them.**
1. **Data layer** — `trigger_points.json`, loaded once. Nothing else touches the raw file.
2. **Interaction/logic layer** — region selection, point selection, search, reverse lookup, free/paid gating. Framework-agnostic where possible.
3. **Visual skin layer** — the body illustration and styling.

Why: the visual skin will be swapped later (region blocks → polished anatomical illustration) and the free/paid line will move. If those are tangled into the logic, every change becomes a rebuild. Keep the seams clean.

---

## Roadmap & status

- **Phase 1 — Data foundation.** ✅ DONE. `trigger_points.json` built and validated.
- **Phase 2 — Interactive map (CURRENT).** Start with **simple tappable region blocks** for the 5 regions (fastest, zero licensing/accuracy risk). Tap region → list its points → tap point → detail panel (location, referral, protocol, stretch, caution). Build the skin as a swappable layer.
- **Phase 3 — Reverse lookup.** Start from *where it hurts* using `referral_index`. "Outer thigh" → the muscles that refer there. The killer feature.
- **Phase 4 — Brand + safety polish.** Clinical styling, disclaimers, free/paid gating.
- **Phase 5 — Ship.** Deploy to free host (Vercel/Netlify), link from Stan.store.

Later swap: polished anatomical illustration (white / teal / thin lines) replaces the region blocks — drops into the visual skin layer with no logic changes.

---

## Brand & aesthetic (non-negotiable feel)

- Clinical, minimalist, premium, educational. NOT spa, NOT wellness-cliché, NOT hype.
- White background, **teal accent**, thin anatomical lines, high contrast, minimal clutter.
- Mobile readability first. Big tap targets. Fast.
- Direct, plain-language copy a client could repeat back. No fluff.

---

## Safety & compliance (hard rules)

- **Educational framing only.** No medical-claim language, no "diagnose," no "cure."
- Show the `meta.disclaimer` text clearly (e.g. footer + first-run notice).
- On any point where `caution` is true, display the `caution_note` prominently in the detail panel.
- Every protocol already carries the "stop if sharp/electrical/nerve symptoms" rule — keep it visible, don't strip it.

---

## Working principles for this project

- Work in **small, reviewable steps.** One thing at a time. Let me preview and react before moving on.
- **Use git** from the start so I can undo cleanly. Commit after each working step.
- After building, **run it locally** so I can preview before we continue.
- No browser localStorage/sessionStorage assumptions that break gating — keep state simple.
- When you hit a real design fork, stop and lay out the options with tradeoffs rather than picking silently.

## Definition of done — v1

Tap a region → see its points → tap a point → full detail with caution handling, clinical styling, disclaimer visible, running locally, committed to git. Reverse lookup and paid gating come next.
