# Canvas & Page Behavior (v1)

The canvas is an exploration mode, not the entire product. Roughdraft should still feel complete when a user opens a single markdown file directly for reading, editing, and review.

## Canvas

### Scrolling
- Default scroll behavior (scroll wheel / two-finger swipe) pans the canvas — same as Figma/tldraw
- Shift + scroll wheel zooms in/out
- Pinch-to-zoom on trackpad works as expected
- No scroll bars — the canvas is infinite in all directions

### Background
- Dot grid pattern that moves with the canvas
- Dots should be subtle (light gray on white)
- Grid spacing scales with zoom level

### Panning
- Click and drag on empty space (not on a page) pans the canvas
- Cursor changes to grabbing hand while panning

## Pages

### Rendering
- Each page is a card positioned at its x/y from `roughdraft.json`
- Cards have a fixed width (e.g. 680px, matching our editor max-width)
- Height is determined by content — no fixed height, no scrolling within the card
- Content renders as fully styled markdown (the actual tiptap editor, not a preview)
- Cards have a subtle border/shadow to distinguish from the canvas background

### Dragging
- Drag to reposition by grabbing the card's top edge / title bar area
- Dragging inside the card body selects text (normal editor behavior)
- Position changes save back to `roughdraft.json`
- Cursor changes to grab/grabbing when hovering the drag handle area

### Editing
- Click inside a card body to place cursor and start editing
- Click away (on canvas or another card) to deselect
- Edits save automatically (debounced, same as current behavior)

### Visual hierarchy
- Selected/active card has a slightly more prominent border or shadow
- Cards render at the zoom level of the canvas (text scales with zoom)

### Relationship to file-first mode
- The same page editor should work both when viewing a whole folder on the canvas and when opening a single markdown file directly
- Canvas behavior should not force users into a multi-page workflow when they just want to review one document
- Review features like CriticMarkup comments and suggested changes are as important as page positioning

## Page Management

### Creating
- "+" button (floating, bottom-right or similar) to create a new page
- New page appears near the current viewport center
- New page is immediately selected for editing
- In single-file mode, page creation may be hidden or disabled because the user is intentionally scoped to one document

### Deleting
- Keyboard shortcut to delete (e.g. when card is selected but not editing)
- Or a small "x" / trash icon on the card's drag handle area
- In single-file mode, deletion may be hidden or disabled for the same reason

## Implementation

### Custom canvas (no library)
- Roll our own — no tldraw, react-flow, or other canvas libraries
- Container div with `overflow: hidden`
- Track `offsetX`, `offsetY`, and `scale` in React state
- Inner div with `transform: translate(${x}px, ${y}px) scale(${scale})`
- Cards are absolutely positioned children at their x/y coordinates within the inner div

### Wheel / gesture handling
- `wheel` event without modifiers → pan (update offsetX/offsetY by deltaX/deltaY)
- `wheel` event with `ctrlKey` (how browsers report pinch gestures) → zoom
- `wheel` event with `shiftKey` → also zoom (explicit shift+scroll)
- Zoom toward the cursor position, not the origin
- Clamp zoom range (e.g. 10%–400%)

### Pointer handling
- `pointerdown` on empty canvas space starts a pan drag
- `pointermove` / `pointerup` continue/end the pan
- `pointerdown` on a card's drag handle starts a card reposition drag
- `pointerdown` inside a card's editor body does nothing special (falls through to tiptap for text selection/editing)
- Use `pointer-events` CSS or event target checks to distinguish these cases
