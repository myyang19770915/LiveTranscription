## ADDED Requirements

### Requirement: Menus fade in when they open

The sentence menu (`#sentenceMenu`) and the header avatar menu (`.account-menu`) SHALL, when the user does not ask for reduced motion, fade in from `opacity: 0` to `opacity: 1` and slide 4px down into place over 150ms each time they open. With `prefers-reduced-motion: reduce` they SHALL NOT move; the pages' existing reduced-motion rule that turns all transitions off MAY also leave out the fade, so the menu appears at once. Closing SHALL NOT be animated.

#### Scenario: Opening a menu

- **WHEN** the browser reports `prefers-reduced-motion: no-preference` and the user opens the sentence menu or the avatar menu
- **THEN** the menu has a running opacity transition of 150ms that ends at `opacity: 1`

#### Scenario: Reduced motion

- **WHEN** the browser reports `prefers-reduced-motion: reduce` and the user opens either menu
- **THEN** the menu's computed `translate` is `none` from the moment it opens
