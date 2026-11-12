# CSS Cleanup & Optimization

I want you to review and clean up the entire CSS codebase to make it more consistent, reusable, readable, and maintainable.

The goal is **clean, well-structured CSS**, not extreme optimization. Prioritize readability and maintainability over reducing every possible line of code.

## 1. Identify and remove duplicated CSS
- Look for classes and selectors that contain identical or very similar styling.
- Consolidate duplicated styles into reusable classes where it makes sense.
- Avoid creating multiple classes that essentially do the same thing.
- If multiple elements share the same styling, reuse an existing class or create a more generic one.
- Avoid unnecessary repetition of CSS properties across different selectors.

## 2. Improve class and ID naming
- Review whether class and ID names accurately describe their purpose.
- Identify classes that are being reused for elements unrelated to their original purpose.
- For example, if `.download-btn` is also used to style a regular action button, consider renaming it to something more generic, such as `.action-btn`, if that better represents its actual use.
- Use descriptive, consistent, and reusable naming conventions.
- Avoid overly specific names when the styling is actually generic.
- Avoid overly generic names when the styling is component-specific.

## 3. Improve CSS structure and readability
- Organize CSS logically into sections based on components, functionality, or page areas.
- Group related styles together.
- Remove unnecessary or redundant CSS properties.
- Remove unused classes, IDs, and selectors where it is safe to confirm they are no longer needed.
- Keep formatting and indentation consistent.
- Make sure media queries and responsive styles are easy to find and understand.

## 4. Improve reusability
- Identify opportunities to create reusable utility classes or shared component styles.
- Use common styling patterns for elements that serve similar purposes.
- Consider shared styles for buttons, inputs, cards, containers, spacing, typography, and other frequently repeated elements.
- Avoid creating abstractions for elements that only happen to look similar but serve completely different purposes.
- Don't over-engineer the CSS with unnecessary utility classes or complex abstractions.

## 5. General CSS improvements
Look for other opportunities to improve the CSS, including:
- Unnecessary specificity.
- Overly complex selectors.
- Conflicting or overridden declarations.
- Redundant media queries.
- Inconsistent spacing, colors, typography, borders, and shadows.
- Opportunities to use CSS variables for repeated values.
- Unnecessary `!important` declarations.
- Repeated styling that could be handled through inheritance.
- Outdated or unnecessary CSS patterns.

## 6. Important rules
- Do not change the visual appearance or layout of the application.
- Do not break existing functionality.
- Do not rename classes or IDs without updating every reference to them throughout the project, including HTML, JSX, JavaScript, and other relevant files.
- Be careful with dynamically generated classes and selectors used by JavaScript.
- Do not remove styles simply because they appear unused without verifying that they aren't referenced dynamically or in other parts of the application.
- Preserve responsive behavior across all screen sizes.
- Avoid unnecessary dependencies or external CSS libraries.
- Do not rewrite the entire CSS architecture just for the sake of optimization.
- Keep the solution practical and easy for another developer to understand.

## 7. Workflow
1. Inspect the entire project and identify all CSS files and styling approaches being used.
2. Analyze duplicated styles, naming inconsistencies, unused selectors, and structural problems.
3. Plan the cleanup before making changes.
4. Apply the improvements throughout the project.
5. Check all references to renamed, merged, or removed classes and IDs.
6. Run the available build, linting, and tests.
7. Review the final changes for unintended visual or functional differences.

## 8. Final report
When finished, provide a short summary containing:
- What duplicated CSS was consolidated.
- Which classes or IDs were renamed and why.
- What unused or redundant CSS was removed.
- What structural and readability improvements were made.
- Any issues or potential improvements you intentionally left untouched.

**Overall objective:** Make the CSS cleaner, more consistent, reusable, and easier to maintain without sacrificing readability, functionality, or the existing design. Use good judgment rather than optimizing for the fewest possible lines of CSS.
