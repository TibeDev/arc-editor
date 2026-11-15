# T3 Code — UI/UX Design System & Recreation Specification

**Reference application:** [T3 Code](https://github.com/pingdotgg/t3code)  
**Repository:** `pingdotgg/t3code`  
**Document type:** Product design and frontend implementation specification  
**Primary objective:** Recreate the visual language, layout, component styling, interaction patterns, and overall experience of T3 Code.

---

# 1. Design Philosophy

## 1.1 Overall aesthetic

T3 Code uses a restrained, developer-oriented interface.

The visual language can be described as:

- Minimalist developer tooling.
- Monochromatic dark surfaces.
- Extremely restrained use of accent colors.
- Compact information architecture.
- Subtle borders rather than prominent card outlines.
- Minimal shadows and carefully controlled elevation.
- Dense but readable typography.
- Functional controls with little decorative treatment.
- A strong emphasis on workspace and content rather than navigation chrome.

The interface should feel like a serious desktop development application rather than a typical SaaS dashboard.

It takes visual inspiration from applications such as:

- Linear
- Cursor
- Visual Studio Code
- Codex
- Modern terminal applications

However, the objective is not to combine these products. The goal is to reproduce the particular visual character of T3 Code.

## 1.2 Core design principles

### Principle 1: Content over decoration

The interface should prioritize the actual development conversation, agent output, terminal, and code changes.

Avoid:
- Large decorative illustrations.
- Excessive gradients.
- Oversized headings.
- Decorative dashboard cards.
- Large colored backgrounds.
- Unnecessary visual separators.

### Principle 2: Black is a structural color

The default dark theme is not simply a collection of dark gray cards.

It uses several carefully differentiated black and near-black surfaces.

The sidebar, workspace, toolbar, editor, and elevated elements have distinct roles.

These differences should be subtle.

### Principle 3: Borders should be almost invisible

Borders are used to establish separation, not to decorate components.

A border should generally become noticeable only when the user looks for it.

### Principle 4: Interactions should feel immediate

The application should feel responsive.

Hover states, selection states, menus, panels, and drawers should use short, controlled transitions.

Avoid animations that make the application feel like a website.

### Principle 5: Information density matters

T3 Code is a professional tool.

It should display substantial information without making the interface feel cluttered.

Use compact metadata, small icons, restrained labels, and consistent spacing.

---

# 2. Design Tokens

This section establishes the foundation of the recreation.

The following default theme values are extracted from the T3 Code source, specifically its shared theme definitions.

## 2.1 Dark color palette

The default T3 Code dark palette is predominantly black.

| Token | Value | Purpose |
|---|---|---|
| Canvas | `#0A0A0A` | Main application background |
| Chrome | `#0A0A0A` | Application chrome |
| Toolbar | `#0A0A0A` | Toolbar background |
| Surface | `#111111` | Standard surfaces |
| Surface raised | `#111111` | Raised surfaces |
| Surface overlay | `#111111` | Overlays |
| Sidebar | `#000000` | Sidebar background |
| Sidebar control | `#0A0A0A` | Sidebar controls |
| Sidebar hover | `#131313` | Sidebar hover state |
| Sidebar active | `#1A1B1B` | Active sidebar row |
| Sidebar selected | `#111111` | Selected sidebar row |
| Border | `#191919` | Standard border |
| Toolbar border | `#191919` | Toolbar separation |
| Input | `#1E1E1E` | Input-related color |
| Text | `#F5F5F5` | Primary text |
| Muted text | `#818181` | Secondary text |
| Sidebar text | `#F1F3F7` | Sidebar primary text |
| Sidebar muted | `#A3A3A3` | Sidebar secondary text |
| Accent | `#346BF1` | Primary interactive accent |
| Focus | `#346BF1` | Focus indicator |
| Error | `#FB414A` | Error state |
| Warning | `#FE9A00` | Warning state |

### Important implementation detail

Do not use `#111111` for every component.

The application needs a deliberate surface hierarchy:

1. Main canvas: `#0A0A0A`.
2. Sidebar: `#000000`.
3. Standard content surfaces: `#111111`.
4. Hovered rows: `#131313`.
5. Active rows: `#1A1B1B`.
6. Subtle borders: `#191919`.

The differences are small, but they are important.

The overall effect should be a nearly black interface with barely perceptible separation between regions.

## 2.2 Light theme

T3 Code also supports a light appearance.

The default light palette includes:

| Token | Value |
|---|---|
| Canvas | `#FCFCFC` |
| Chrome | `#FCFCFC` |
| Surface | `#FFFFFF` |
| Raised surface | `#FCFCFC` |
| Sidebar | `#FAFAFA` |
| Border | `#E4E4E7` |
| Text | `#27272A` |
| Muted text | `#71717B` |
| Accent | `#1B4ED8` |

The light theme should preserve the same visual hierarchy as the dark theme.

Do not design it as an unrelated interface.

## 2.3 Color usage rules

The accent blue should be used selectively.

Use it for:
- Focus indicators.
- Important active controls.
- Selected interactive states where appropriate.
- Links and relevant actions.
- Update-related indicators.

Do not use it for:
- Every button.
- Large background sections.
- General panel backgrounds.
- Decorative gradients.
- Every selected row.

Most of the interface should remain neutral.

## 2.4 Typography

### Primary font

The source defines the following system font stack:

`-apple-system, BlinkMacSystemFont, "Inter Variable", "Segoe UI", system-ui, sans-serif`

The preferred visual result is an understated modern sans-serif.

Characteristics:
- Neutral letterforms.
- Excellent small-size readability.
- Moderate character width.
- No exaggerated geometric styling.
- Consistent weight hierarchy.

### Monospace font

The source defines:

`ui-monospace, "SF Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace`

Use monospace for:
- Terminal content.
- Code blocks.
- File paths.
- Technical identifiers.
- Keyboard shortcuts.
- Relevant code metadata.

### Typography scale

Recommended recreation values:

| Element | Size | Weight |
|---|---:|---|
| Main page title | 18–20px | 600 |
| Section heading | 14–16px | 600 |
| Standard body | 13–14px | 400 |
| Sidebar item | 12–13px | 400–500 |
| Secondary metadata | 11–12px | 400 |
| Compact metadata | 10–11px | 400 |
| Code content | 12–13px | 400 |
| Button label | 12–13px | 500 |

These are implementation targets, not claims that every T3 Code component uses these exact font sizes.

### Typography rules

- Avoid oversized text.
- Avoid unnecessary bold text.
- Use muted text for secondary information.
- Maintain readable line heights.
- Use consistent font weights.
- Keep technical information visually distinct through monospace typography rather than color.

---

# 3. Spacing and Geometry

The application uses compact, semantic spacing tokens.

Several important values are explicitly defined in `apps/web/src/index.css`.

## 3.1 Extracted layout values

| Property | Source value |
|---|---:|
| Control radius | 8px |
| Sidebar content inset | 8px |
| Sidebar control gap | 8px |
| Sidebar row content inset | 10px |
| Command shell inset | 8px |
| Command content inset | 16px |
| Floating content inset | 12px |
| Workspace topbar | 52px |
| Workspace gutter | 12px |
| Larger-screen workspace gutter | 20px |
| Chat content maximum width | 736px |
| Thread details panel width | 280px |
| Default scrollbar width | 6px |

These values should form the basis of the implementation.

## 3.2 Spacing scale

Use a consistent four-point spacing system.

| Token | Value | Usage |
|---|---:|---|
| 1 | 4px | Tiny gaps |
| 2 | 8px | Compact spacing |
| 3 | 12px | Standard compact spacing |
| 4 | 16px | Normal spacing |
| 5 | 20px | Larger content spacing |
| 6 | 24px | Section spacing |
| 8 | 32px | Major section spacing |

Do not introduce arbitrary spacing values throughout the application.

## 3.3 Corner radii

The overall interface should have modest corner radii.

Recommended values:

| Component | Radius |
|---|---:|
| Small controls | 6px |
| Standard controls | 8px |
| Inputs | 8px |
| Popovers | 10px |
| Dialogs | 12px |
| Larger floating surfaces | 12–14px |

Avoid excessively rounded components.

In particular, avoid making the application look like a mobile-first SaaS dashboard with pill-shaped controls everywhere.

## 3.4 Borders

Use thin one-pixel borders.

Dark theme:
- Standard border: `#191919`.
- More subtle separators: approximately `#141414`.
- Hover borders: slightly more visible than the default.

Light theme:
- Standard border: `#E4E4E7`.

Avoid:
- Double borders.
- Thick outlines.
- Strong card outlines.
- Multiple nested borders around a single component.

---

# 4. Application Layout

The application should be structured around a persistent workspace.

The main desktop experience is based on three conceptual areas:

1. Navigation sidebar.
2. Main workspace.
3. Optional contextual panel.

## 4.1 Desktop structure

The application should occupy the entire viewport.

The overall structure:

```text
┌──────────────────────────────────────────────────────────────┐
│                       Application Topbar                     │
├────────────────┬─────────────────────────────┬───────────────┤
│                │                             │               │
│                │                             │               │
│                │                             │               │
│    Sidebar     │       Main Workspace        │  Inspector    │
│                │                             │  / Context    │
│                │                             │               │
│                │                             │               │
│                │                             │               │
│                │                             │               │
└────────────────┴─────────────────────────────┴───────────────┘
```

The inspector is contextual rather than permanently required.

The application should also support layouts without the inspector.

## 4.2 Sidebar

The sidebar is a fundamental part of the visual identity.

Its background should be black in the default dark theme.

It should feel integrated into the application rather than like a separate floating card.

### Sidebar structure

Recommended hierarchy:

```text
┌────────────────────────────┐
│ T3 Code             Controls│
├────────────────────────────┤
│ + New Thread               │
│ Search                     │
├────────────────────────────┤
│ Projects                   │
│                            │
│ Project A                  │
│   Thread 1                 │
│   Thread 2                 │
│                            │
│ Project B                  │
│   Thread 3                 │
├────────────────────────────┤
│ Settings                   │
└────────────────────────────┘
```

### Sidebar visual treatment

- Full-height black background.
- Subtle right border.
- Compact navigation rows.
- Small icons.
- Muted labels.
- Minimal visual hierarchy.
- Small spacing between navigation groups.

### Sidebar rows

Default:
- Transparent background.
- Muted or primary text depending on hierarchy.

Hover:
- Background `#131313`.

Selected:
- Background `#111111`.

Active:
- Background approximately `#1A1B1B`.

Use a small transition between states.

### Sidebar interaction

Implement:
- Hover actions.
- Context menus.
- Project expansion and collapse.
- Thread selection.
- Thread search.
- Drag-and-drop organization.
- Pinning.
- Settled and active thread sections.

The reference application has considerably more advanced sidebar behavior than a simple static navigation menu.

---

# 5. Main Workspace

The main workspace is where most of the user's attention should remain.

It should be visually quiet.

Do not place unnecessary cards or containers around the content.

## 5.1 Workspace background

Default dark background:

`#0A0A0A`

Use this as the primary canvas.

The content should appear naturally positioned inside the workspace, not enclosed in a large decorative card.

## 5.2 Workspace header

The header should be compact.

Recommended structure:

```text
┌──────────────────────────────────────────────────────┐
│ Project / Thread title              Actions   Menu   │
└──────────────────────────────────────────────────────┘
```

Characteristics:
- Approximately 52px topbar height.
- Small typography.
- Minimal controls.
- Muted secondary information.
- Subtle border separation.
- No large header background treatment.

## 5.3 Content alignment

Use a centered content column where appropriate.

The source defines:

`--chat-content-max-width: 46rem`

This gives the main chat content a maximum width of 736px.

Use consistent horizontal gutters.

On larger screens, do not stretch the conversation across the entire available viewport.

The surrounding empty space is an important part of the visual design.

---

# 6. Chat and Agent Conversation Interface

The conversation interface is one of the most important components to recreate accurately.

It should resemble a developer communication environment, not a generic chatbot.

## 6.1 Conversation structure

A conversation should support:

- User messages.
- Agent responses.
- Thinking and progress states.
- Tool activity.
- Command execution.
- File references.
- Code blocks.
- Errors.
- Permission requests.
- Completion states.

## 6.2 Message styling

Use a restrained presentation.

Avoid making every message a large, rounded card.

The content should primarily be presented through typography, spacing, and subtle surface differentiation.

### User messages

Use a subtle message surface.

Default dark message surface:

`#141414`

Text:

`#F5F5F5`

Keep the message width controlled.

### Agent messages

Agent output should be visually integrated into the main conversation.

Use:
- Clear paragraph spacing.
- Consistent text hierarchy.
- Technical formatting.
- Inline code styling.
- Code blocks.
- Small metadata labels where needed.

Avoid excessive background containers around the agent's entire response.

## 6.3 Code blocks

Code blocks must feel native to a developer tool.

Requirements:
- Monospace typography.
- Dark code background.
- Clear syntax highlighting.
- Small copy controls.
- Horizontal scrolling where necessary.
- Consistent padding.
- Minimal borders.

Use the dedicated code background token rather than the accent color.

## 6.4 Agent activity

Agent activity should be visible without overwhelming the conversation.

Use compact activity indicators and clear status labels.

Examples:
- Running.
- Waiting.
- Completed.
- Failed.
- Needs approval.

Status colors should be semantic.

Do not use large colored status cards.

## 6.5 Composer

The message composer should be a central visual element.

It should feel like a carefully designed developer input surface.

### Structure

```text
┌───────────────────────────────────────────────┐
│                                               │
│  Write a message...                            │
│                                               │
│                                               │
│  + Attachments   Model / Agent      Send  ↑   │
└───────────────────────────────────────────────┘
```

### Visual styling

- Dark surface.
- Subtle border.
- Approximately 8–12px corner radius.
- Compact toolbar.
- Muted placeholder text.
- Small icons.
- Clear send action.
- No unnecessary decoration.

### Interaction states

Implement:
- Default.
- Hover.
- Focus.
- Disabled.
- Sending.
- Attachment added.
- Model selection.
- Expanded composer.

The source also implements a specialized mobile composer transition. This is worth reproducing if mobile support is part of the project.

---

# 7. Contextual Panels and Developer Tools

T3 Code is more than a conversation interface.

Its workspace includes contextual development tools.

These should use the same visual language.

## 7.1 Terminal

The terminal should use:
- A dedicated terminal background.
- Monospace typography.
- Minimal chrome.
- Subtle borders.
- Small toolbar controls.
- Native-feeling scrolling.

Default terminal colors are defined separately from the rest of the application.

The default terminal background is `#0A0A0A`.

## 7.2 Git and diff views

The Git interface should display changes in a compact, readable format.

Requirements:
- Clear file hierarchy.
- Monospace code.
- Green additions.
- Red deletions.
- Muted file metadata.
- Compact action controls.
- Minimal panel decoration.

The diff view should prioritize the actual code changes.

## 7.3 Inspector panel

The inspector should be contextual.

It can contain information such as:
- Thread details.
- Files.
- Git information.
- Pull request information.
- Other contextual workspace tools.

Use a narrow panel rather than allowing it to dominate the main workspace.

The source defines a 280px thread details panel width.

## 7.4 Drawers and floating surfaces

Floating surfaces should have restrained elevation.

The source defines a glass treatment using:

- 12px blur in the default configuration.
- 80% opacity.
- Saturation of 1.14.

Dark mode adjusts the blur to 16px and saturation to 1.08.

Use glass effects selectively.

Do not make the entire application translucent.

---

# 8. Buttons and Controls

Buttons should look understated and functional.

## 8.1 Primary button

Use the accent color for important actions.

Dark theme accent:

`#346BF1`

Characteristics:
- Compact height.
- Clear label.
- Small radius.
- Moderate font weight.
- No excessive shadow.

## 8.2 Secondary button

Use neutral backgrounds.

A secondary button should not compete with the primary action.

## 8.3 Ghost button

Many toolbar and sidebar actions should be visually minimal.

Default:
- Transparent background.
- Muted icon.
- No visible border.

Hover:
- Slight background change.
- Increased icon contrast.

## 8.4 Icon buttons

Use consistent icon sizing.

Recommended:
- 14px for compact controls.
- 16px for standard controls.
- 18px for larger toolbar actions.

Prefer simple line icons.

Lucide-style iconography is appropriate.

Avoid:
- Filled cartoon icons.
- Mixed icon styles.
- Oversized icons.
- Excessive decorative symbols.

## 8.5 Inputs

Inputs should blend into the surrounding interface.

Use:
- Subtle background.
- Thin border.
- Clear focus state.
- Muted placeholder.
- Compact padding.

Avoid bright outlines except when focused.

---

# 9. Popovers, Menus and Dialogs

These components should feel like native desktop application controls.

## 9.1 Popovers

Use:
- Dark background.
- Subtle border.
- Modest radius.
- Small typography.
- Minimal shadow.
- Compact spacing.

Menus should not be oversized.

## 9.2 Context menus

Context menus should support:
- Clear item labels.
- Small icons.
- Keyboard shortcuts.
- Separators between logical groups.
- Destructive actions.
- Disabled states.

Use red only for destructive actions.

## 9.3 Dialogs

Dialogs should have a restrained appearance.

Characteristics:
- Dark surface.
- Subtle border.
- Approximately 12px radius.
- Clear heading.
- Compact content.
- Simple footer actions.

Avoid excessive gradients, decorative illustrations, and large visual treatments.

---

# 10. Motion and Animation

Motion should communicate interaction and state.

It should not become a major part of the visual identity.

## 10.1 General principles

- Short transitions.
- Subtle easing.
- No unnecessary bouncing.
- No excessive scaling.
- No large movement.
- Avoid animations on every element.

## 10.2 Recommended timings

These are recreation recommendations.

| Interaction | Duration |
|---|---:|
| Hover state | 100–140ms |
| Button state | 100–140ms |
| Menu appearance | 120–180ms |
| Drawer movement | 200–280ms |
| Dialog appearance | 140–200ms |
| Panel transitions | 180–250ms |

The source defines a drawer easing curve:

`cubic-bezier(0.32, 0.72, 0, 1)`

This is a useful starting point for sliding surfaces.

## 10.3 Performance

Animation performance is part of the design.

Prefer:
- Transform.
- Opacity.
- Compositor-friendly transitions.
- Limited animated shadows.

Avoid continuously animating large areas.

Respect reduced-motion preferences.

---

# 11. Responsive Behavior

The application should adapt to available screen space without losing its identity.

## 11.1 Desktop

Desktop is the primary workspace experience.

Use:
- Persistent sidebar.
- Main workspace.
- Optional inspector.
- Contextual panels.
- Keyboard shortcuts.
- Hover interactions.

## 11.2 Tablet

The sidebar and workspace should adapt to the available width.

The inspector should become a sheet when there is insufficient space for a third column.

## 11.3 Mobile

Mobile should not simply be a compressed desktop interface.

Use:
- Navigation stack.
- Compact thread header.
- Full-width conversation.
- Bottom composer.
- Native-feeling sheets.
- Safe-area-aware positioning.
- Touch-friendly controls.

The project has separate mobile architecture and styling, so desktop component dimensions should not be blindly copied into mobile.

---

# 12. Themes and Customization

One important aspect of the current T3 Code implementation is its theme system.

The application supports multiple built-in themes, including:

- T3 Code.
- T3 Chat.
- Grove.
- Ocean.
- Ember.
- Iris.

Each theme can have light and dark variants.

The web/desktop implementation also supports custom themes.

The theme system is based on semantic color roles rather than isolated hardcoded colors.

The source defines 61 color roles covering:
- Application canvas.
- Toolbar.
- Sidebar.
- Surfaces.
- Text.
- Borders.
- Inputs.
- Accent colors.
- Messages.
- Code.
- Search.
- Terminal.
- Status indicators.

### Recommendation

Implement semantic CSS variables.

Example:

```css
:root {
  --canvas: #0a0a0a;
  --chrome: #0a0a0a;
  --surface: #111111;
  --surface-raised: #111111;
  --sidebar: #000000;

  --text: #f5f5f5;
  --text-muted: #818181;

  --border: #191919;
  --input: #1e1e1e;

  --accent: #346bf1;
  --accent-foreground: #ffffff;

  --sidebar-hover: #131313;
  --sidebar-active: #1a1b1b;
}
```

Every component should consume these variables.

Never scatter literal color values across individual component files.

---

# 13. Component Architecture

The recreation should use reusable components.

Suggested component hierarchy:

```text
Application
│
├── WorkspaceLayout
│   │
│   ├── ApplicationHeader
│   │
│   ├── Sidebar
│   │   ├── SidebarHeader
│   │   ├── NewThreadButton
│   │   ├── SearchButton
│   │   ├── ProjectList
│   │   ├── ProjectItem
│   │   ├── ThreadList
│   │   └── SidebarFooter
│   │
│   ├── MainWorkspace
│   │   ├── ThreadHeader
│   │   ├── Conversation
│   │   │   ├── UserMessage
│   │   │   ├── AgentMessage
│   │   │   ├── CodeBlock
│   │   │   ├── AgentActivity
│   │   │   └── PermissionRequest
│   │   │
│   │   └── Composer
│   │       ├── ComposerInput
│   │       ├── AttachmentControls
│   │       ├── ModelSelector
│   │       └── SendButton
│   │
│   └── Inspector
│       ├── ThreadDetails
│       ├── GitPanel
│       └── FilePanel
│
├── TerminalDrawer
├── CommandPalette
├── ContextMenu
├── Dialog
└── Toast
```

The hierarchy is a proposed recreation architecture, not a claim that the repository uses these exact component names.

---

# 14. Technical Implementation Recommendations

## 14.1 Frontend

Recommended stack:

- React.
- TypeScript.
- Tailwind CSS.
- CSS variables for semantic design tokens.
- Lucide icons.
- Zustand or equivalent state management.

The reference web application uses React, TypeScript, Tailwind CSS, and Lucide React among its dependencies.

## 14.2 Styling architecture

Organize styling into:

```text
src/
  styles/
    tokens.css
    themes.css
    typography.css
    animations.css

  components/
    layout/
    sidebar/
    workspace/
    conversation/
    composer/
    terminal/
    inspector/
    overlays/
    ui/
```

## 14.3 Component rules

Every component should:
- Use shared design tokens.
- Support dark mode.
- Have consistent spacing.
- Use the shared radius system.
- Support hover and focus states.
- Avoid unnecessary borders.
- Use consistent icon sizes.
- Avoid hardcoded colors.

## 14.4 Layout rules

Use CSS Grid for the overall workspace.

Use Flexbox for:
- Toolbars.
- Navigation rows.
- Button groups.
- Composer controls.
- Message metadata.

Use independent scroll containers where appropriate.

Avoid making the entire application scroll as one document.

---

# 15. Visual Recreation: What Matters Most

Not every component contributes equally to the overall appearance.

The following elements should receive the most attention.

| Priority | Element | Importance |
|---|---|---|
| 1 | Overall dark palette | Critical |
| 2 | Sidebar proportions and styling | Critical |
| 3 | Main workspace layout | Critical |
| 4 | Typography and spacing | Critical |
| 5 | Conversation presentation | Critical |
| 6 | Composer design | Very high |
| 7 | Borders and surface hierarchy | Very high |
| 8 | Iconography | High |
| 9 | Menus and popovers | High |
| 10 | Animation details | Medium |

A recreation with perfect icons but incorrect surface hierarchy will not look like T3 Code.

Likewise, a recreation with the correct colors but oversized typography and excessive spacing will feel like a different application.

---

# 16. Common Mistakes to Avoid

Do not:

1. Make every panel a rounded card.
2. Use bright blue as the primary background.
3. Use excessive gradients.
4. Add large shadows to ordinary components.
5. Use oversized typography.
6. Make buttons excessively rounded.
7. Put visible borders around everything.
8. Use large gaps between compact navigation items.
9. Make the sidebar visually dominant.
10. Use multiple competing accent colors.
11. Make the conversation look like a generic chatbot.
12. Add decorative dashboard widgets that do not belong in the reference experience.
13. Ignore hover, selected, disabled, and focus states.
14. Stretch conversation content across the entire screen.
15. Treat mobile as a scaled-down desktop.

The most common failure will be reproducing the general dark aesthetic while missing the actual component proportions and visual hierarchy.

---

# 17. Implementation Checklist

## Foundation

- [ ] Establish the default dark palette.
- [ ] Implement semantic CSS variables.
- [ ] Configure the font stacks.
- [ ] Establish spacing tokens.
- [ ] Establish radius tokens.
- [ ] Configure border colors.
- [ ] Configure scrollbar styling.
- [ ] Implement theme switching.

## Layout

- [ ] Full-height application shell.
- [ ] Persistent sidebar.
- [ ] Main workspace.
- [ ] Contextual inspector.
- [ ] Responsive layout.
- [ ] Independent scroll regions.

## Sidebar

- [ ] Header and branding.
- [ ] New thread action.
- [ ] Search.
- [ ] Project groups.
- [ ] Thread rows.
- [ ] Active and selected states.
- [ ] Hover actions.
- [ ] Context menus.

## Conversation

- [ ] User messages.
- [ ] Agent messages.
- [ ] Code blocks.
- [ ] Inline code.
- [ ] Tool activity.
- [ ] Permission requests.
- [ ] Completion states.
- [ ] Error states.

## Composer

- [ ] Input surface.
- [ ] Attachment controls.
- [ ] Model selector.
- [ ] Send button.
- [ ] Focus state.
- [ ] Disabled state.
- [ ] Expanded state.

## Developer tools

- [ ] Terminal.
- [ ] Git panel.
- [ ] Diff viewer.
- [ ] File information.
- [ ] Thread inspector.

## Polish

- [ ] Hover transitions.
- [ ] Menu animations.
- [ ] Drawer animations.
- [ ] Keyboard focus.
- [ ] Reduced motion.
- [ ] Dark/light theme consistency.
- [ ] Desktop window integration.

---

# 18. Final Design Direction

The recreation should follow one fundamental rule:

**Make the application look like a native-feeling, highly refined developer workspace, not a dark-themed SaaS dashboard.**

The visual identity depends on restraint.

Use black and near-black surfaces, subtle borders, compact typography, carefully aligned content, and small purposeful controls.

The interface should feel almost understated when nothing is happening. When an agent is working, requesting approval, or displaying code changes, the relevant information should become immediately clear.

That balance between minimal visual noise and high information density is the most important characteristic to reproduce.

---

# 19. Source References

The following source files should be treated as the primary implementation references when recreating the interface.

| File | What to inspect |
|---|---|
| `apps/web/src/index.css` | Global styling, geometry, typography, animation tokens |
| `packages/shared/src/themePalettes.ts` | Default colors and theme definitions |
| `apps/web/src/themePalette.ts` | Theme application and customization |
| `apps/web/src/components/AppSidebarLayout.tsx` | Workspace layout |
| `apps/web/src/components/Sidebar.tsx` | Sidebar implementation |
| `apps/web/src/components/threadSidebarWidth.ts` | Sidebar sizing |
| `apps/web/src/components/ui/sidebar` | Shared sidebar primitives |
| `apps/web/src/hooks/useTheme.ts` | Theme behavior |
| `docs/internals/overview.md` | Application architecture |

Repository: https://github.com/pingdotgg/t3code

**Important:** This specification describes the default T3 Code visual direction. The application also supports alternative themes and platform-specific layouts. For a truly pixel-accurate recreation, compare actual application screenshots against the implementation at identical viewport dimensions and states.
