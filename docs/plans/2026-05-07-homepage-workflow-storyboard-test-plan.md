# Homepage Workflow Storyboard Test Plan

## Harness requirements

No new test harness needs to be built.

- **Vitest/JSDOM homepage harness**: existing `packages/app/test/homepage.test.tsx` renders `Homepage` into a DOM container with React `act`, mocked clipboard, and geometry shims. It exposes DOM queries, text assertions, CTA click simulation, and document-order checks. Complexity: existing harness plus a small `renderHomepage(root)` helper. Tests depending on it: 1, 2, 5.
- **Playwright homepage harness**: existing `packages/app/playwright.config.ts` serves the Vite app and runs browser tests under `packages/app/e2e/*.spec.ts`. It exposes real browser layout, viewport resizing, accessibility role/name queries, DOM snapshots, screenshot capture, and computed overflow checks. Complexity: one focused homepage spec. Tests depending on it: 3, 4.

## Strategy reconciliation

The agreed Medium strategy still holds. The implementation plan confirms the work is a static React homepage change in `packages/app/src/App.tsx` with supporting CSS in `packages/app/src/style.css`, backed by Vitest/JSDOM semantic assertions and one focused Playwright browser check. There are no new routes, runtime services, paid APIs, persistence layers, or CLI/server changes that would expand the test surface.

The only adjustment is to make the Playwright work a named homepage storyboard spec rather than a generic visual check. That keeps the cost and scope unchanged while matching the implementation plan's specific DOM hooks: `[data-homepage-workflow-storyboard]` and `[data-homepage-workflow-scene]`.

## Test plan

1. **Name**: Visitor understands the six-step plan-review workflow before the Markdown format explanation
   - **Type**: scenario
   - **Harness**: Vitest/JSDOM homepage harness in `packages/app/test/homepage.test.tsx`.
   - **Preconditions**: Render `Homepage` with the existing homepage marketing message and `updateStatus={null}`.
   - **Actions**: Query the rendered DOM for `[data-homepage-workflow-storyboard]`, `.rfm-format-demo`, and all `[data-homepage-workflow-scene]` elements.
   - **Expected outcome**: The storyboard exists, is labelled by `homepage-workflow-heading`, and appears before `.rfm-format-demo` in document order. The storyboard includes the source-of-truth heading `Review an agent's plan before it starts coding.`, the body copy `Ask for a plan, mark it up in Roughdraft, click Done Reviewing, and the agent continues from the edited Markdown file.`, and exactly six scenes numbered `01` through `06` with these titles in order: `Ask for a plan`, `The agent works normally`, `Roughdraft opens the plan`, `Leave comments and suggestions`, `Click Done Reviewing`, `The agent resumes`. Source of truth: user request scenes 1-6 and implementation plan Product copy and scene content.
   - **Interactions**: React render tree, homepage section order, Roughdraft format demo placement.

2. **Name**: Storyboard shows the concrete homepage conversion handoff from chat to Roughdraft to resumed agent
   - **Type**: scenario
   - **Harness**: Vitest/JSDOM homepage harness in `packages/app/test/homepage.test.tsx`.
   - **Preconditions**: Render `Homepage` with the existing homepage marketing message and `updateStatus={null}`.
   - **Actions**: Query `[data-homepage-workflow-storyboard]` text content.
   - **Expected outcome**: The storyboard contains the canonical user request `Let's make the homepage more persuasive. Write a plan first.`, the agent response about drafting a Markdown plan and opening it in Roughdraft, the tool activity `rg "It's just Markdown" packages/app/src`, `sed -n '1,220p' packages/app/src/App.tsx`, and `write .context/homepage-conversion-plan.md`, the plan title `Homepage Conversion Plan`, the plan bullets about moving the workflow above `"It's just Markdown."`, showing the pause/review/resume signal, and keeping the format section as portable Markdown proof, the two review comments, the suggested change `Review an agent's plan before it starts coding.`, the Done popover title `Review complete`, its body `Your agent can read the edited Markdown file now.`, and the resumed-agent message beginning `I read your comments.` Source of truth: implementation plan Primary mock conversation and plan content.
   - **Interactions**: Mock chat surface, mock Roughdraft document surface, comment/suggestion mock surface, Done Reviewing popover mock, resumed-agent mock.

3. **Name**: Desktop homepage renders a usable storyboard section with browser evidence
   - **Type**: integration
   - **Harness**: Playwright homepage spec, for example `packages/app/e2e/homepage-workflow-storyboard.spec.ts`.
   - **Preconditions**: Start from a clean browser page at `/` with a desktop viewport such as `1440x1100`.
   - **Actions**: Navigate to `/`, locate `[data-homepage-workflow-storyboard]`, assert key section text is visible, count `[data-homepage-workflow-scene]`, and capture a screenshot artifact of the storyboard locator named `homepage-workflow-storyboard-desktop.png` or an equivalent Playwright snapshot name.
   - **Expected outcome**: The storyboard locator is visible, all six scene titles are visible, the Roughdraft plan panel text `Homepage Conversion Plan` is visible, the Done Reviewing button mock is visible, and the captured screenshot is non-empty by Playwright's screenshot operation succeeding on the visible locator. Pass/fail is based on Playwright assertions and the generated targeted screenshot artifact, not human inspection. Source of truth: user request for a storyboard with text and screenshots or real UI, implementation plan requiring Playwright render and screenshot evidence.
   - **Interactions**: Vite dev server, compiled Tailwind/CSS, browser layout engine, static image asset from the existing homepage.

4. **Name**: Mobile homepage storyboard remains readable without horizontal overflow
   - **Type**: invariant
   - **Harness**: Playwright homepage spec, in the same focused homepage storyboard file.
   - **Preconditions**: Start from a clean browser page at `/` with a mobile viewport such as `390x844`.
   - **Actions**: Navigate to `/`, locate `[data-homepage-workflow-storyboard]`, assert the section heading and six scene titles are visible, then evaluate `document.documentElement.scrollWidth <= document.documentElement.clientWidth` and the same condition for the storyboard element.
   - **Expected outcome**: The storyboard heading `Review an agent's plan before it starts coding.` remains visible, all six scene titles remain visible, and neither the page nor the storyboard element creates horizontal overflow. Source of truth: user request for a conversion section above Markdown, implementation plan's responsive in-page mock UI direction, and frontend requirement that text and UI not overlap or overflow on mobile.
   - **Interactions**: Responsive CSS, grid layout, long strings in chat/tool-call mock surfaces, viewport constraints.

5. **Name**: Existing homepage conversion affordances and Markdown proof survive the storyboard replacement
   - **Type**: regression
   - **Harness**: Vitest/JSDOM homepage harness in `packages/app/test/homepage.test.tsx`.
   - **Preconditions**: Render `Homepage` with the existing homepage marketing message and `updateStatus={null}`.
   - **Actions**: Use the existing CTA test flow: verify hero copy and trust badges, verify GitHub/spec links, verify the setup prompt is absent before opening the dialog, click `Install Now`, click `Copy prompt`, and click the existing `Review a plan` format-demo sample.
   - **Expected outcome**: The hero still contains `Easier collaboration with your coding agent`, `Free`, `Open-source`, and `Runs locally`; the GitHub link still points to `https://github.com/Lex-Inc/roughdraft`; the spec link still points to `/roughdraft-flavored-markdown`; the setup dialog still copies the exact `AGENT_SETUP_PROMPT`; the image source remains `/sneak-peek.png`; `.rfm-format-demo` still renders source/result panes; the format demo still contains live comment and suggested-change markup surfaces; clicking `Review a plan` still shows `Agent Plan Review`, `rollback note for the migration step`, and `re: s1`. The removed legacy two-card workflow copy is not asserted. Source of truth: existing homepage tests and implementation plan instruction to replace the old workflow while keeping the CTA and format demo.
   - **Interactions**: shadcn Dialog and Button components, clipboard mock, RoughdraftFormatDemo, homepage image asset, React state for format-demo examples.

## Coverage summary

Covered action space:

- A visitor reading the homepage hero, trust badges, screenshot, new workflow storyboard, and Markdown format proof.
- The six requested storyboard scenes and their order.
- The conversion-specific example: asking an agent to improve homepage persuasion, agent tool activity, a Markdown plan opened in Roughdraft, inline comments/suggestions, Done Reviewing handoff, and resumed agent chat.
- The required placement above `It's just Markdown`.
- Desktop render evidence and mobile no-overflow behavior.
- Existing install CTA, GitHub/spec links, setup prompt copy behavior, screenshot asset, and Roughdraft format demo behavior.

Explicitly excluded per the agreed Medium strategy:

- Full-page visual baselines for every viewport. Risk: subtle visual polish regressions may pass if semantic/layout assertions still hold, but this avoids brittle screenshot churn for a marketing section.
- Real CLI invocation of `roughdraft open`, server blocking behavior, and filesystem round-trip tests. Risk: the storyboard could overpromise if copy drifts toward live CLI behavior, mitigated by assertions that keep the copy scoped to the implementation plan and existing ADRs.
- Parser, editor, and CriticMarkup serialization changes. Risk: none expected because the implementation plan does not modify parser/editor code; existing targeted tests continue to cover those systems.
- Performance benchmarking. Risk: low because the section is static UI with no new runtime dependencies, network calls, or expensive interactions.
