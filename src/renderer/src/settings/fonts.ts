// The catalogue itself now lives in shared/fonts.ts — main needs it too (to
// know what to download and validate ids against), so it moved out of the
// renderer. This file re-exports it under the same name renderer code
// already imports (`./fonts`), so SpaceFonts.tsx/Collection.tsx/model.ts
// didn't need to change their import paths for the move.
export * from '../../../shared/fonts'
