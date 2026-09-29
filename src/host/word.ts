export interface WordEventHandlers {
  onCommentAdded?: () => void;
  onCommentRemoved?: () => void;
  onParagraphAdded?: () => void;
}

/**
 * コメントの数を数え直す間隔。
 * Word のコメントの追加・削除イベント (onCommentAdded など) はプレビュー版の API にしかなく、
 * onAnnotationInserted は校正などの注釈 (annotation) のイベントでコメントでは起きないので、数を比べて見分ける
 */
const COMMENT_POLL_MS = 2000;

async function countComments(): Promise<number> {
  return Word.run(async (context) => {
    const comments = context.document.body.getComments();
    comments.load("items/id");
    await context.sync();
    return comments.items.length;
  });
}

/** コメントの数を一定間隔で数え、増えたら onAdded、減ったら onRemoved を呼ぶ (最初の数は、登録できたかの確認を兼ねて待つ) */
async function watchComments(onAdded?: () => void, onRemoved?: () => void): Promise<void> {
  let previous = await countComments();
  const poll = async () => {
    // 作業ウィンドウが見えていない間は数えない
    if (!document.hidden) {
      const count = await countComments().catch(() => previous);
      if (count > previous) onAdded?.();
      else if (count < previous) onRemoved?.();
      previous = count;
    }
    window.setTimeout(poll, COMMENT_POLL_MS);
  };
  window.setTimeout(poll, COMMENT_POLL_MS);
}

/** Word のコメント追加・削除と、段落追加を購読する (Word ホストでのみ呼び出すこと) */
export async function watchWordEvents(handlers: WordEventHandlers): Promise<void> {
  if (handlers.onParagraphAdded) {
    await Word.run(async (context) => {
      context.document.onParagraphAdded.add(async () => handlers.onParagraphAdded!());
      await context.sync();
    });
  }
  // コメントを数える getComments() は WordApi 1.4 から
  if ((handlers.onCommentAdded || handlers.onCommentRemoved) && Office.context.requirements.isSetSupported("WordApi", "1.4")) {
    await watchComments(handlers.onCommentAdded, handlers.onCommentRemoved);
  }
}
