export function shouldAutofocusComposer(opts: {
  coarsePointer: boolean;
  composerHadFocus: boolean;
  anyFinePointer?: boolean;
  hover?: boolean;
}): boolean {
  // Desktop-like: всегда фокусируем, чтобы можно было печатать без лишнего клика.
  if (!opts.coarsePointer) return true;

  // iPadOS и гибридные устройства могут иметь coarsePointer=true, но при этом пользователь взаимодействует мышью/трекпадом.
  // В таком случае автофокус ожидаем и он не воспринимается как "неожиданное" открытие клавиатуры.
  if (opts.anyFinePointer || opts.hover) return true;

  // Pure touch: не форсим фокус (иначе всплывает клавиатура/масштаб «прыгает»), но сохраняем его если пользователь уже печатал.
  return opts.composerHadFocus;
}
