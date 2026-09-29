export interface WordEventHandlers {
  onAnnotationInserted?: () => void;
  onAnnotationRemoved?: () => void;
  onParagraphAdded?: () => void;
}

/** Word のコメント追加・削除、段落追加イベントを購読する (Word ホストでのみ呼び出すこと) */
export async function watchWordEvents(handlers: WordEventHandlers): Promise<void> {
  await Word.run(async (context) => {
    const doc = context.document;
    if (handlers.onAnnotationInserted) doc.onAnnotationInserted.add(async () => handlers.onAnnotationInserted!());
    if (handlers.onAnnotationRemoved) doc.onAnnotationRemoved.add(async () => handlers.onAnnotationRemoved!());
    if (handlers.onParagraphAdded) doc.onParagraphAdded.add(async () => handlers.onParagraphAdded!());
    await context.sync();
  });
}
