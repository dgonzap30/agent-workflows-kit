---
name: design-stack
description: Legacy multi-provider design workflow. Use only when explicitly requested and after verifying its named tools; keep disabled for ordinary design work.
disable-model-invocation: true
---

# Design Stack

## Description
Full design workflow orchestrating Stitch, Nano Banana, 21st.dev Magic, and UI UX Pro Max together. Use when the user wants to design, prototype, or build UI — from concept to coded components.

## Trigger
- User asks to design, prototype, or mockup anything
- User says "design stack", "full design", "mockup to code", "design workflow"
- User wants to go from idea → mockup → assets → components

## User-invocable
- design-stack: Orchestrate the full design pipeline — from design system to mockups to coded components

## Critical Rules
1. **ALL 4 tools MUST be used on full runs. Partial runs are allowed when the user requests a specific phase.**
2. **The end result MUST always be a visually stunning, premium-looking site.** No generic AI output. No placeholder aesthetics.
3. **Use 21st.dev Magic component library aggressively.** Pull real components, patterns, and inspiration from the library. Every page should look like it was built by a top design agency using premium assets — not cobbled together with defaults.
4. **Use Nano Banana for rich visual assets everywhere.** Hero images, section backgrounds, feature illustrations, testimonial photos, team photos, product shots. Sites should feel asset-rich, not text-heavy.
5. **If a tool fails or is unavailable, report the error — do NOT silently skip it.**

## Instructions

When invoked, follow this pipeline. Ask the user what they're building, then execute ALL phases.

### Step 1: Clarify the Brief
Ask (if not already clear):
- What are you building? (landing page, dashboard, mobile app, etc.)
- What's the product/brand? (name, industry, vibe)
- Any style preferences? (minimal, bold, glassmorphism, etc.)
- What stack? (React, Next.js, HTML+Tailwind, etc.)

### Step 2: Design System — UI UX Pro Max (MANDATORY)
You MUST use the Skill tool to invoke `ui-ux-pro-max` here. Call:
```
Skill(skill: "ui-ux-pro-max")
```
This activates the design intelligence engine which generates:
- Color palette, typography, style direction
- Layout pattern and section structure
- Anti-patterns to avoid
- Pre-delivery checklist

Save the full design system output — all subsequent steps MUST reference it.

### Step 3: Mockups — Stitch MCP (MANDATORY)
You MUST use Stitch MCP tools to generate visual mockups:
1. `create_project` — name it after the product
2. `generate_screen_from_text` — generate screens using the design system from Step 2 as prompt context
   - Include the exact colors, typography, style, and layout from Step 2 in the prompt
   - Use `GEMINI_3_PRO` for hero/key screens, `GEMINI_3_FLASH` for secondary
3. `get_screen` — review results, iterate if needed

### Step 4: Assets — Nano Banana MCP (MANDATORY)
You MUST use Nano Banana MCP tools to fill the site with rich visual assets:
- Hero illustrations, section backgrounds, feature visuals, product shots
- Team/testimonial photos, decorative elements, social proof imagery
- Specify aspect ratios matching the design (16:9 for heroes, 1:1 for avatars, 4:3 for cards, etc.)
- Reference the exact color palette and style from Step 2
- Generate assets for EVERY major section — the site should feel asset-rich, not text-heavy
- Minimum: hero image + 1 asset per content section

### Step 5: Components — 21st.dev Magic MCP (MANDATORY)
You MUST use 21st.dev Magic MCP tools to generate coded components:
- Search the 21st.dev component library FIRST — use existing polished components as a foundation before generating from scratch
- Generate UI components from natural language descriptions, referencing the design system from Step 2
- Use SVGL integration for all logos and icons — never use emoji
- Request multiple variations, pick the most visually striking one
- Every section of the page should use a real component from the library or a high-quality generated one
- The goal is a site that looks like it uses a premium component library — because it does

### Step 6: Assembly & Validation (MANDATORY)
- Wire all components from Step 5 together with assets from Step 4
- Validate against the design system checklist from Step 2:
  - [ ] No emojis as icons (SVG only: Heroicons/Lucide/SVGL)
  - [ ] `cursor-pointer` on all clickable elements
  - [ ] Hover states with smooth transitions (150-300ms)
  - [ ] Text contrast 4.5:1 minimum
  - [ ] Focus states for keyboard nav
  - [ ] `prefers-reduced-motion` respected
  - [ ] Responsive: 375px, 768px, 1024px, 1440px

### Tool Reference
| Tool | Type | Key Actions |
|------|------|-------------|
| UI UX Pro Max | Skill (`ui-ux-pro-max`) | Design system, palettes, typography, style rules |
| Stitch | MCP `stitch` (HTTP) | `create_project`, `generate_screen_from_text`, `list_screens`, `get_screen`, `get_project` |
| Nano Banana | MCP `nano-banana` (stdio) | Image generation with Gemini, aspect ratios, templates |
| 21st.dev Magic | MCP `magic` (stdio) | Component generation, SVGL icons/logos, style variations |
