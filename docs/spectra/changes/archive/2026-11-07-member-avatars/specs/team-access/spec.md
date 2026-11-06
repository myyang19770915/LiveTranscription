## ADDED Requirements

### Requirement: Member profile photos

A system administrator SHALL be able to set, replace and remove a profile photo for any team member account from the team administration page, including an account that has not signed in yet. A photo SHALL belong to the account (lower-cased username), so the same photo is shown in every team the account belongs to. The browser SHALL crop the chosen image to its centre square and scale it to 160×160 before uploading. The server SHALL accept only PNG, JPEG or WebP images whose leading bytes match the declared type, of 1 byte to 256 KB, and SHALL reject anything else, including SVG. Any signed-in user SHALL be able to read a photo; only a system administrator SHALL be able to change one. API responses that list people SHALL carry an `avatarUrl` that changes whenever the photo changes, or `null` when there is none. Wherever an avatar is shown on the team administration page and the action board (cards, the avatar filter, owner swimlanes, the detail panel), a person with a photo SHALL be shown with the photo, and a person without one, or whose photo fails to load, SHALL keep the existing initial avatar.

#### Scenario: Administrator sets a photo

- **WHEN** a system administrator chooses an image for member alice on the team administration page
- **THEN** the image is cropped and scaled to 160×160, uploaded, and alice's row shows the photo instead of her initial

#### Scenario: Photo appears on the action board

- **WHEN** alice has a photo and a signed-in user opens the action board
- **THEN** alice's avatar in the avatar filter, on her cards and in the detail panel shows the photo

#### Scenario: No photo keeps the initial

- **WHEN** bob has no photo, or his photo fails to load
- **THEN** bob's avatar shows his initial on his stable colour, as before

#### Scenario: Removing a photo

- **WHEN** a system administrator removes alice's photo
- **THEN** reading the photo returns 404, `avatarUrl` is `null`, and her avatar shows her initial again

#### Scenario: Only administrators change photos

- **WHEN** a signed-in user who is not a system administrator uploads or removes a photo
- **THEN** the request is refused with 403 and the photo is unchanged

#### Scenario: Unsafe or oversized images are refused

- **WHEN** an upload is SVG, is labelled PNG but does not start with the PNG signature, or is larger than 256 KB
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
