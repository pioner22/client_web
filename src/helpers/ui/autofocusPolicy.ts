export function shouldAutofocusComposer(opts: { coarsePointer: boolean; composerHadFocus: boolean }): boolean {
  if (!opts.coarsePointer) return true;
  return opts.composerHadFocus;
}

