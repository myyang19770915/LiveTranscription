## ADDED Requirements

### Requirement: The avatar menu works from the keyboard

The header avatar menu (`.account-menu`, `role="menu"`) SHALL open as a popover (`popover="auto"`) directly below the avatar with its right edge aligned to the avatar. On opening, the focus SHALL move to the first visible menu item. The down and up arrows SHALL move the focus to the next and previous visible item, wrapping at either end; Home and End SHALL move it to the first and last visible item. Escape or Tab SHALL close the menu and return the focus to the avatar, and a click outside the menu SHALL close it. Pressing the avatar while the menu is open SHALL close it without reopening it. Pressing the down arrow on the avatar SHALL open the menu with the focus on the first visible item, and pressing the up arrow SHALL open it with the focus on the last. Items hidden at the current width SHALL be skipped. The items, their order and the widths at which they show SHALL stay as "Hidden header links stay reachable on narrow screens" states.

#### Scenario: Opening with the mouse

- **WHEN** a signed-in user clicks the avatar on `/meetings` at 1440px
- **THEN** `.account-menu` matches `:popover-open`, its top is below the avatar's bottom edge, and the focus is on the first visible `[role=menuitem]`

#### Scenario: Moving through the items

- **WHEN** the avatar menu is open and the user presses End, then the down arrow, then Escape
- **THEN** End focuses the last visible item, the down arrow wraps the focus to the first visible item, and Escape closes the menu with the focus on the avatar

#### Scenario: Items for a narrow window

- **WHEN** the avatar menu is opened on `/meetings` at 900px and the user presses the down arrow through every item
- **THEN** the focus visits the page links shown in the menu at that width and never an item hidden at that width

#### Scenario: Pressing the avatar again

- **WHEN** the avatar menu is open and the user clicks the avatar
- **THEN** the menu is closed and stays closed
