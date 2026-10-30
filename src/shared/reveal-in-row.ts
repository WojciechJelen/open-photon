// What is left beside a tile brought into its row: its ring and focus outline, and a little more.
const TILE_ROOM = 8;

/** Brings a tile wholly into its scrolling `row`, sideways only: the page does not move. */
export function revealInRow(tile: Element, row: Element) {
  const { left, right } = tile.getBoundingClientRect();
  const view = row.getBoundingClientRect();
  const before = left - TILE_ROOM - view.left;
  const after = right + TILE_ROOM - view.right;

  if (before < 0) {
    row.scrollBy({ left: before });
  } else if (after > 0) {
    row.scrollBy({ left: after });
  }
}

/** Brings a row's pressed tile into its view: the pick, wherever the row was scrolled. */
export function revealPressed(row: Element | null) {
  const tile = row?.querySelector("[aria-pressed=true]");

  if (tile && row) {
    revealInRow(tile, row);
  }
}
