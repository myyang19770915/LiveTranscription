## ADDED Requirements

### Requirement: Naming a new series works with input methods

In the new-series field (`#seriesName`) on `/`, a key press of Enter or Escape that belongs to an input method composition (`event.isComposing` is true or `event.keyCode` is 229) SHALL be left to the input method: Enter SHALL NOT create a series and Escape SHALL NOT close the new-series row. An Enter outside a composition SHALL create the series as before, and an Escape outside a composition SHALL close the row as before.

#### Scenario: Confirming a candidate with Enter

- **WHEN** the user types 研發週會 with a Zhuyin input method in `#seriesName` and presses Enter to confirm the candidate
- **THEN** no request is sent to `POST /api/teams/{team}/series` and the field keeps the text

#### Scenario: Enter after the composition

- **WHEN** the composition has ended and the user presses Enter again
- **THEN** one request is sent to `POST /api/teams/{team}/series` with the name in the field

##### Example: Key events in the field

| keydown event | Series request sent | Row closes |
| --- | --- | --- |
| `{key:'Enter', isComposing:true}` | no | no |
| `{key:'Enter', isComposing:false, keyCode:229}` | no | no |
| `{key:'Enter', isComposing:false, keyCode:13}` | yes, once | n/a |
| `{key:'Escape', isComposing:true}` | no | no |
| `{key:'Escape', isComposing:false, keyCode:27}` | no | yes |
