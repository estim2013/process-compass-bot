export function evidenceClarification(source) {
  if (!source?.title || !source?.section) return null;
  return `Нашла связанный раздел ${source.section} документа «${source.title}», но не смогла надёжно связать его формулировку с вашим вопросом. Не хочу угадывать — уточните, пожалуйста, относится ли вопрос именно к этому разделу?`;
}
