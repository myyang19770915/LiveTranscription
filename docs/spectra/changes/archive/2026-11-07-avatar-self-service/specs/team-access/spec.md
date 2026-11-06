## MODIFIED Requirements

### Requirement: Member profile photos

A system administrator SHALL be able to set, replace and remove a profile photo for any team member account from the team administration page, including an account that has not signed in yet; on that page the member's avatar itself SHALL be the control that opens the image picker, and a remove control SHALL be shown only when the member has a photo. Every signed-in user SHALL be able to set, replace and remove their own photo from the avatar menu in the page header, and SHALL NOT be able to change anyone else's. A photo SHALL belong to the account (lower-cased username), so the same photo is shown in every team the account belongs to. The browser SHALL crop the chosen image to its centre square and scale it to 160×160 before uploading. The server SHALL accept only PNG, JPEG or WebP images whose leading bytes match the declared type, of 1 byte to 256 KB, and SHALL reject anything else, including SVG. Any signed-in user SHALL be able to read a photo. API responses that list people, and the signed-in user's own `/api/me`, SHALL carry an `avatarUrl` that changes whenever the photo changes, or `null` when there is none. Wherever an avatar is shown on the team administration page, the page header and the action board (cards, the avatar filter, owner swimlanes, the detail panel), a person with a photo SHALL be shown with the photo, and a person without one, or whose photo fails to load, SHALL keep the existing initial avatar. Avatars SHALL stay circular and centred, including a pressed avatar filter button.

#### Scenario: Administrator sets a photo

- **WHEN** a system administrator clicks member alice's avatar on the team administration page and chooses an image
- **THEN** the image is cropped and scaled to 160×160, uploaded, and alice's row shows the photo instead of her initial

#### Scenario: A user changes their own photo

- **WHEN** a signed-in user opens the avatar menu in the page header, chooses 更換照片 and picks an image
- **THEN** the photo is stored for their own account, the header avatar shows it, and the action board shows it on their cards without a full page reload

#### Scenario: A user removes their own photo

- **WHEN** a signed-in user with a photo chooses 移除照片 in the header avatar menu
- **THEN** their `avatarUrl` becomes `null` and their avatar shows their initial again

#### Scenario: Photo appears on the action board

- **WHEN** alice has a photo and a signed-in user opens the action board
- **THEN** alice's avatar in the avatar filter, on her cards and in the detail panel shows the photo

#### Scenario: Pressed avatar filter stays round

- **WHEN** a user presses the avatar filter button of a person with a photo
- **THEN** the button is as wide as it is tall and the photo sits centred inside a round highlight

#### Scenario: No photo keeps the initial

- **WHEN** bob has no photo, or his photo fails to load
- **THEN** bob's avatar shows his initial on his stable colour, as before

#### Scenario: Removing a photo

- **WHEN** a system administrator removes alice's photo
- **THEN** reading the photo returns 404, `avatarUrl` is `null`, and her avatar shows her initial again

#### Scenario: Only administrators change other people's photos

- **WHEN** a signed-in user who is not a system administrator uploads or removes a photo through the administrator API
- **THEN** the request is refused with 403 and the photo is unchanged

#### Scenario: Unsafe or oversized images are refused

- **WHEN** an upload, by an administrator or by a user for themselves, is SVG, is labelled PNG but does not start with the PNG signature, or is larger than 256 KB
- **THEN** the request is refused (415 for the type, 413 for the size) and no photo is stored

##### Example: Upload checks

| Content type | Body | Result |
| ------------ | ---- | ------ |
| image/png | PNG signature, 2 KB | 200, stored |
| image/webp | RIFF....WEBP, 20 KB | 200, stored |
| image/svg+xml | `<svg ...>` | 415 |
| image/png | JPEG bytes | 415 |
| image/jpeg | JPEG bytes, 300 KB | 413 |
| image/png | empty | 422 |
